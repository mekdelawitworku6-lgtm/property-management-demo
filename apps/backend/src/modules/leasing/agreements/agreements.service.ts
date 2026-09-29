import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgreementStatus, ApprovalStatus, Prisma, RentalRequest, Unit, UnitStatus, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { assertCanAccess, isPlatformStaff, requireOwnerId, scopeWhere } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { addDays, formatDate, startOfDayUtc } from '../../../common/utils/date.util';
import { generateReference } from '../../../common/utils/reference.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { NotificationsService } from '../../core-services/notifications/notifications.service';
import { RealtimeGateway } from '../../core-services/realtime/realtime.gateway';
import { InvoicesService } from '../../billing/invoices/invoices.service';
import {
  buildAgreementContent,
  computeEndDate,
  computeSignatureHash,
  hashContent,
  verifyAgreementIntegrity,
} from './utils/agreement-content.util';
import {
  AddDocumentDto,
  AgreementFilterDto,
  CreateAgreementDto,
  LeaseTermsDto,
  RenewAgreementDto,
  SignAgreementDto,
  TerminateAgreementDto,
} from './dto/agreement.dto';

type Tx = Prisma.TransactionClient;
type UnitWithProperty = Unit & { property: { id: string; ownerId: string; name: string; address: string; city: string; subCity: string | null } };

const AGREEMENT_INCLUDE = {
  unit: { select: { id: true, unitNumber: true, type: true } },
  property: { select: { id: true, name: true, address: true, city: true, subCity: true } },
  tenant: { select: { id: true, fullName: true, phoneNumber: true } },
  owner: { select: { id: true, fullName: true, phoneNumber: true } },
} satisfies Prisma.AgreementInclude;

export interface AgreementDraftParams {
  unit: UnitWithProperty;
  owner: Pick<User, 'id' | 'fullName' | 'phoneNumber'>;
  tenant: Pick<User, 'id' | 'fullName' | 'phoneNumber'>;
  startDate: Date;
  durationMonths: number;
  rentAmount: number | Prisma.Decimal;
  depositAmount: number | Prisma.Decimal;
  paymentDueDay: number;
  specialTerms?: string | null;
  rentalRequestId?: string | null;
  renewedFromId?: string | null;
}

/** Rental agreement lifecycle (Section 3.4.1, FR-TEN-03, FR-OWN-04, 4.1.2). */
@Injectable()
export class AgreementsService {
  private readonly logger = new Logger(AgreementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly invoices: InvoicesService,
    private readonly configService: ConfigService,
  ) {}

  /** Builds and inserts a PENDING_SIGNATURE agreement; the owner signs at creation. */
  async createAgreementRecord(tx: Tx, params: AgreementDraftParams) {
    const referenceNo = generateReference('AGR');
    const startDate = startOfDayUtc(params.startDate);
    const endDate = computeEndDate(startDate, params.durationMonths);
    const content = buildAgreementContent({
      referenceNo,
      owner: params.owner,
      tenant: params.tenant,
      property: params.unit.property,
      unit: params.unit,
      startDate,
      endDate,
      rentAmount: params.rentAmount,
      depositAmount: params.depositAmount,
      currency: params.unit.currency,
      paymentDueDay: params.paymentDueDay,
      specialTerms: params.specialTerms,
      unitTerms: params.unit.terms,
    });
    return tx.agreement.create({
      data: {
        referenceNo,
        unitId: params.unit.id,
        propertyId: params.unit.property.id,
        tenantId: params.tenant.id,
        ownerId: params.owner.id,
        rentalRequestId: params.rentalRequestId ?? null,
        renewedFromId: params.renewedFromId ?? null,
        startDate,
        endDate,
        rentAmount: params.rentAmount,
        depositAmount: params.depositAmount,
        currency: params.unit.currency,
        paymentDueDay: params.paymentDueDay,
        specialTerms: params.specialTerms ?? null,
        content,
        contentHash: hashContent(content),
        ownerSignedAt: new Date(),
        ownerSignature: params.owner.fullName,
      },
    });
  }

  /** Called by RentalRequestsService.accept inside its transaction (3.4.1: created on acceptance). */
  async createFromRequest(
    tx: Tx,
    request: RentalRequest & { unit: UnitWithProperty; tenant: User },
    owner: User,
    terms: LeaseTermsDto = {},
  ) {
    return this.createAgreementRecord(tx, {
      unit: request.unit,
      owner,
      tenant: request.tenant,
      startDate: terms.startDate ? new Date(terms.startDate) : request.desiredStartDate,
      durationMonths: terms.durationMonths ?? request.durationMonths,
      rentAmount: terms.rentAmount ?? request.unit.rentAmount,
      depositAmount: terms.depositAmount ?? request.unit.depositAmount,
      paymentDueDay: terms.paymentDueDay ?? 1,
      specialTerms: terms.specialTerms,
      rentalRequestId: request.id,
    });
  }

  async assertOwnerApproved(ownerId: string): Promise<User> {
    const owner = await this.prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) throw new NotFoundException('Owner not found');
    if (owner.approvalStatus !== ApprovalStatus.APPROVED || owner.isSuspended) {
      throw new ForbiddenException('Owner account must be approved by the platform admin first');
    }
    return owner;
  }

  /** Owner creates a lease directly for an existing tenant (offline tenant onboarding, 4.1.2). */
  async createDirect(user: AuthUser, dto: CreateAgreementDto) {
    const ownerId = requireOwnerId(user);
    const owner = await this.assertOwnerApproved(ownerId);
    const unit = await this.prisma.unit.findUnique({ where: { id: dto.unitId }, include: { property: true } });
    if (!unit || unit.property.ownerId !== ownerId) throw new NotFoundException('Unit not found');
    if (unit.status !== UnitStatus.VACANT) throw new BadRequestException(`Unit is ${unit.status}`);
    const tenant = await this.prisma.user.findFirst({ where: { id: dto.tenantId, role: UserRole.TENANT } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.isSuspended) throw new BadRequestException('Tenant account is suspended');

    const agreement = await this.prisma.$transaction(async (tx) => {
      const created = await this.createAgreementRecord(tx, {
        unit,
        owner,
        tenant,
        startDate: new Date(dto.startDate),
        durationMonths: dto.durationMonths,
        rentAmount: dto.rentAmount ?? unit.rentAmount,
        depositAmount: dto.depositAmount ?? unit.depositAmount,
        paymentDueDay: dto.paymentDueDay ?? 1,
        specialTerms: dto.specialTerms,
      });
      await tx.unit.update({ where: { id: unit.id }, data: { status: UnitStatus.RESERVED } });
      return created;
    });
    await this.afterCreated(user, agreement);
    return agreement;
  }

  /** Shared post-creation side effects: audit, tenant notification, realtime sync. */
  async afterCreated(actor: AuthUser | null, agreement: { id: string; referenceNo: string; tenantId: string; ownerId: string }) {
    await this.audit.log(AUDIT_ACTIONS.AGREEMENT_CREATED, 'Agreement', agreement.id, actor, { referenceNo: agreement.referenceNo });
    await this.notifications.notify([agreement.tenantId], 'AGREEMENT_READY', { reference: agreement.referenceNo }, {
      sms: true,
      data: { agreementId: agreement.id },
    });
    this.realtime.emitToUsers([agreement.tenantId, agreement.ownerId], REALTIME_EVENTS.AGREEMENT_UPDATED, agreement);
    this.realtime.emitToStaff(REALTIME_EVENTS.AGREEMENT_UPDATED, agreement);
  }

  async findAll(user: AuthUser, filter: AgreementFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.AgreementWhereInput = {
      ...scopeWhere(user),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
      ...(filter.unitId ? { unitId: filter.unitId } : {}),
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.ownerId && isPlatformStaff(user) ? { ownerId: filter.ownerId } : {}),
    };
    const [docs, total] = await Promise.all([
      this.prisma.agreement.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: AGREEMENT_INCLUDE,
        omit: { content: true },
      }),
      this.prisma.agreement.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  /** Signed copy is identical for tenant, owner and admin; includes an integrity check. */
  async findOne(user: AuthUser, id: string) {
    const agreement = await this.prisma.agreement.findUnique({
      where: { id },
      include: {
        ...AGREEMENT_INCLUDE,
        renewedFrom: { select: { id: true, referenceNo: true } },
        renewedTo: { select: { id: true, referenceNo: true, status: true } },
      },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    assertCanAccess(user, agreement);
    return { ...agreement, integrity: verifyAgreementIntegrity(agreement) };
  }

  /** FR-TEN-03: tenant signs digitally → ACTIVE, unit OCCUPIED, invoices generated. */
  async sign(user: AuthUser, id: string, dto: SignAgreementDto) {
    const agreement = await this.prisma.agreement.findUnique({
      where: { id },
      include: { unit: true, renewedFrom: true },
    });
    if (!agreement || agreement.tenantId !== user.id) throw new NotFoundException('Agreement not found');
    if (agreement.status !== AgreementStatus.PENDING_SIGNATURE) {
      throw new BadRequestException(`Agreement is ${agreement.status}`);
    }
    if (dto.contentHash !== agreement.contentHash) {
      throw new BadRequestException('Agreement text changed since you reviewed it. Reload and review again.');
    }
    const isRenewal = Boolean(agreement.renewedFromId);
    if (isRenewal && agreement.renewedFrom?.status !== AgreementStatus.ACTIVE) {
      throw new BadRequestException('The agreement being renewed is no longer active');
    }
    if (!isRenewal && agreement.unit.status !== UnitStatus.RESERVED) {
      throw new BadRequestException('Unit is no longer reserved for this agreement');
    }

    const signedAt = new Date();
    const signatureName = dto.signatureName.trim();
    const signed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.agreement.updateMany({
        where: { id, status: AgreementStatus.PENDING_SIGNATURE },
        data: {
          status: AgreementStatus.ACTIVE,
          tenantSignedAt: signedAt,
          tenantSignature: signatureName,
          tenantSignatureIp: user.ip ?? null,
          signatureHash: computeSignatureHash(agreement.contentHash, user.id, signedAt, signatureName),
        },
      });
      if (result.count !== 1) throw new BadRequestException('Agreement was already signed');
      await tx.unit.update({ where: { id: agreement.unitId }, data: { status: UnitStatus.OCCUPIED } });
      if (isRenewal) {
        await tx.agreement.update({ where: { id: agreement.renewedFromId }, data: { status: AgreementStatus.RENEWED } });
      }
      await this.invoices.generateInitialInvoices(tx, agreement, signedAt);
      return tx.agreement.findUnique({ where: { id }, include: AGREEMENT_INCLUDE });
    });

    await this.audit.log(AUDIT_ACTIONS.AGREEMENT_SIGNED, 'Agreement', id, user, {
      referenceNo: signed.referenceNo,
      contentHash: signed.contentHash,
      signatureHash: signed.signatureHash,
    });
    if (isRenewal) {
      await this.audit.log(AUDIT_ACTIONS.AGREEMENT_RENEWED, 'Agreement', agreement.renewedFromId, user, { renewedTo: id });
    }
    await this.notifications.notifyOwner(signed.ownerId, 'AGREEMENT_SIGNED', {
      reference: signed.referenceNo,
      unit: signed.unit.unitNumber,
      tenant: signed.tenant.fullName,
    }, { data: { agreementId: id } });
    this.realtime.emitToUsers([signed.tenantId, signed.ownerId], REALTIME_EVENTS.AGREEMENT_UPDATED, signed);
    this.realtime.emitToStaff(REALTIME_EVENTS.AGREEMENT_UPDATED, signed);
    return signed;
  }

  /** Owner offers a renewal: a new PENDING_SIGNATURE agreement starting the day after the current one ends. */
  async renew(user: AuthUser, id: string, dto: RenewAgreementDto) {
    const ownerId = requireOwnerId(user);
    const owner = await this.assertOwnerApproved(ownerId);
    const current = await this.prisma.agreement.findFirst({
      where: { id, ownerId },
      include: { unit: { include: { property: true } }, tenant: true, renewedTo: true },
    });
    if (!current) throw new NotFoundException('Agreement not found');
    if (current.status !== AgreementStatus.ACTIVE) throw new BadRequestException('Only active agreements can be renewed');
    if (current.renewedTo && current.renewedTo.status !== AgreementStatus.CANCELLED) {
      throw new BadRequestException('A renewal already exists for this agreement');
    }
    if (current.renewedTo) {
      // A cancelled renewal still holds the unique renewedFromId link — release it first.
      await this.prisma.agreement.update({ where: { id: current.renewedTo.id }, data: { renewedFromId: null } });
    }

    const renewal = await this.prisma.$transaction((tx) =>
      this.createAgreementRecord(tx, {
        unit: current.unit,
        owner,
        tenant: current.tenant,
        startDate: addDays(current.endDate, 1),
        durationMonths: dto.durationMonths,
        rentAmount: dto.rentAmount ?? current.rentAmount,
        depositAmount: dto.depositAmount ?? 0,
        paymentDueDay: current.paymentDueDay,
        specialTerms: dto.specialTerms ?? current.specialTerms,
        renewedFromId: current.id,
      }),
    );
    await this.afterCreated(user, renewal);
    return renewal;
  }

  /** Ends an active agreement early: unit vacated, future unpaid invoices cancelled. */
  async terminate(user: AuthUser, id: string, dto: TerminateAgreementDto) {
    const agreement = await this.prisma.agreement.findUnique({ where: { id }, include: { renewedTo: true } });
    if (!agreement) throw new NotFoundException('Agreement not found');
    if (!isPlatformStaff(user) && agreement.ownerId !== requireOwnerId(user)) {
      throw new NotFoundException('Agreement not found');
    }
    if (agreement.status !== AgreementStatus.ACTIVE) throw new BadRequestException('Only active agreements can be terminated');
    const effectiveDate = startOfDayUtc(dto.effectiveDate ? new Date(dto.effectiveDate) : new Date());

    const terminated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.agreement.update({
        where: { id },
        data: { status: AgreementStatus.TERMINATED, terminatedAt: effectiveDate, terminationReason: dto.reason },
      });
      if (agreement.renewedTo?.status === AgreementStatus.PENDING_SIGNATURE) {
        await tx.agreement.update({ where: { id: agreement.renewedTo.id }, data: { status: AgreementStatus.CANCELLED } });
      }
      await tx.unit.update({ where: { id: agreement.unitId }, data: { status: UnitStatus.VACANT } });
      await this.invoices.cancelFutureInvoices(tx, id, effectiveDate);
      return updated;
    });

    await this.audit.log(AUDIT_ACTIONS.AGREEMENT_TERMINATED, 'Agreement', id, user, { reason: dto.reason, effectiveDate });
    await this.notifications.notify([agreement.tenantId], 'AGREEMENT_TERMINATED', { reference: agreement.referenceNo }, { sms: true });
    await this.notifications.notifyOwner(agreement.ownerId, 'AGREEMENT_TERMINATED', { reference: agreement.referenceNo });
    this.realtime.emitToUsers([agreement.tenantId, agreement.ownerId], REALTIME_EVENTS.AGREEMENT_UPDATED, terminated);
    return terminated;
  }

  /** Owner withdraws, or tenant declines, an unsigned agreement. */
  async cancel(user: AuthUser, id: string) {
    const agreement = await this.prisma.agreement.findUnique({ where: { id } });
    if (!agreement) throw new NotFoundException('Agreement not found');
    assertCanAccess(user, agreement);
    if (agreement.status !== AgreementStatus.PENDING_SIGNATURE) {
      throw new BadRequestException('Only agreements awaiting signature can be cancelled');
    }
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.agreement.update({ where: { id }, data: { status: AgreementStatus.CANCELLED } });
      if (!agreement.renewedFromId) {
        await tx.unit.updateMany({
          where: { id: agreement.unitId, status: UnitStatus.RESERVED },
          data: { status: UnitStatus.VACANT },
        });
      }
      return updated;
    });
    await this.audit.log(AUDIT_ACTIONS.AGREEMENT_CANCELLED, 'Agreement', id, user);
    this.realtime.emitToUsers([agreement.tenantId, agreement.ownerId], REALTIME_EVENTS.AGREEMENT_UPDATED, cancelled);
    return cancelled;
  }

  /** Attach a supporting document (e.g. scanned ID, signed paper copy). The agreement text stays immutable. */
  async addDocument(user: AuthUser, id: string, dto: AddDocumentDto) {
    const agreement = await this.prisma.agreement.findUnique({ where: { id } });
    if (!agreement) throw new NotFoundException('Agreement not found');
    assertCanAccess(user, agreement);
    const updated = await this.prisma.agreement.update({
      where: { id },
      data: { documents: { push: dto.url } },
      omit: { content: true },
    });
    await this.audit.log(AUDIT_ACTIONS.AGREEMENT_DOCUMENT_ADDED, 'Agreement', id, user, { url: dto.url });
    return updated;
  }

  /** Public integrity verification by reference number (QR / printed copy check). */
  async verifyByReference(referenceNo: string) {
    const agreement = await this.prisma.agreement.findUnique({ where: { referenceNo } });
    if (!agreement) throw new NotFoundException('Agreement not found');
    return {
      referenceNo,
      status: agreement.status,
      contentHash: agreement.contentHash,
      signedAt: agreement.tenantSignedAt,
      ...verifyAgreementIntegrity(agreement),
    };
  }

  /** Daily job: ACTIVE agreements past their end date become EXPIRED and the unit is vacated. */
  async expireAgreements(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.agreement.findMany({
      where: { status: AgreementStatus.ACTIVE, endDate: { lt: startOfDayUtc(now) } },
      include: { renewedTo: true },
    });
    for (const agreement of expired) {
      await this.prisma.$transaction(async (tx) => {
        await tx.agreement.update({ where: { id: agreement.id }, data: { status: AgreementStatus.EXPIRED } });
        if (agreement.renewedTo?.status === AgreementStatus.PENDING_SIGNATURE) {
          await tx.agreement.update({ where: { id: agreement.renewedTo.id }, data: { status: AgreementStatus.CANCELLED } });
        }
        await tx.unit.update({ where: { id: agreement.unitId }, data: { status: UnitStatus.VACANT } });
      });
      await this.audit.log(AUDIT_ACTIONS.AGREEMENT_EXPIRED, 'Agreement', agreement.id, null);
      this.realtime.emitToUsers([agreement.tenantId, agreement.ownerId], REALTIME_EVENTS.AGREEMENT_UPDATED, {
        id: agreement.id,
        status: AgreementStatus.EXPIRED,
      });
    }
    return expired.length;
  }

  /** Daily job: automated lease-expiry / renewal reminders to tenant and owner. */
  async sendExpiryReminders(now: Date = new Date()): Promise<number> {
    const days = Number(this.configService.get('LEASE_EXPIRY_REMINDER_DAYS', 30));
    const agreements = await this.prisma.agreement.findMany({
      where: {
        status: AgreementStatus.ACTIVE,
        expiryReminderSentAt: null,
        endDate: { gte: startOfDayUtc(now), lte: addDays(startOfDayUtc(now), days) },
      },
      include: { unit: { select: { unitNumber: true } } },
    });
    for (const agreement of agreements) {
      const params = { reference: agreement.referenceNo, unit: agreement.unit.unitNumber, endDate: formatDate(agreement.endDate) };
      await this.notifications.notify([agreement.tenantId], 'LEASE_EXPIRING', params, { sms: true, data: { agreementId: agreement.id } });
      await this.notifications.notifyOwner(agreement.ownerId, 'LEASE_EXPIRING', params, { data: { agreementId: agreement.id } });
      await this.prisma.agreement.update({ where: { id: agreement.id }, data: { expiryReminderSentAt: now } });
    }
    return agreements.length;
  }
}
