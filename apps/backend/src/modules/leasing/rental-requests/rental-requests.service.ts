import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RentalRequestStatus, UnitStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { isPlatformWide, requireOwnerId, resolveOwnerId } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { startOfDayUtc } from '../../../common/utils/date.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { NotificationsService } from '../../core-services/notifications/notifications.service';
import { RealtimeGateway } from '../../core-services/realtime/realtime.gateway';
import { AVAILABLE_UNIT_WHERE } from '../../property/listings/listings.service';
import { AgreementsService } from '../agreements/agreements.service';
import { LeaseTermsDto } from '../agreements/dto/agreement.dto';
import { CreateRentalRequestDto, RejectRentalRequestDto, RentalRequestFilterDto } from './dto/rental-request.dto';

const REQUEST_INCLUDE = {
  unit: { include: { property: { select: { id: true, name: true, ownerId: true, address: true, city: true, subCity: true } } } },
  tenant: { select: { id: true, fullName: true, phoneNumber: true, phoneVerified: true } },
  agreement: { select: { id: true, referenceNo: true, status: true, contentHash: true } },
} satisfies Prisma.RentalRequestInclude;

/** FR-TEN-02: tenant requests to rent; owner accepts (→ agreement) or rejects. */
@Injectable()
export class RentalRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly agreements: AgreementsService,
  ) {}

  async create(user: AuthUser, dto: CreateRentalRequestDto) {
    const unit = await this.prisma.unit.findFirst({
      where: { id: dto.unitId, ...AVAILABLE_UNIT_WHERE },
      include: { property: true },
    });
    if (!unit) throw new NotFoundException('Unit is not available for rent');
    if (startOfDayUtc(new Date(dto.desiredStartDate)) < startOfDayUtc(new Date())) {
      throw new BadRequestException('Desired start date cannot be in the past');
    }
    const duplicate = await this.prisma.rentalRequest.findFirst({
      where: { unitId: unit.id, tenantId: user.id, status: RentalRequestStatus.PENDING },
    });
    if (duplicate) throw new ConflictException('You already have a pending request for this unit');

    const request = await this.prisma.rentalRequest.create({
      data: {
        unitId: unit.id,
        tenantId: user.id,
        desiredStartDate: startOfDayUtc(new Date(dto.desiredStartDate)),
        durationMonths: dto.durationMonths,
        message: dto.message,
      },
      include: REQUEST_INCLUDE,
    });
    await this.audit.log(AUDIT_ACTIONS.RENTAL_REQUEST_CREATED, 'RentalRequest', request.id, user, { unitId: unit.id });
    await this.notifications.notifyOwner(
      unit.property.ownerId,
      'RENTAL_REQUEST_NEW',
      { tenant: user.fullName, unit: `${unit.property.name} ${unit.unitNumber}` },
      { sms: true, data: { rentalRequestId: request.id } },
    );
    this.realtime.emitToUsers([unit.property.ownerId], REALTIME_EVENTS.RENTAL_REQUEST_UPDATED, request);
    return request;
  }

  async findAll(user: AuthUser, filter: RentalRequestFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const ownerId = resolveOwnerId(user);
    const where: Prisma.RentalRequestWhereInput = {
      ...(isPlatformWide(user) ? {} : ownerId ? { unit: { property: { ownerId } } } : { tenantId: user.id }),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.unitId ? { unitId: filter.unitId } : {}),
      ...(filter.propertyId ? { unit: { propertyId: filter.propertyId, ...(ownerId ? { property: { ownerId } } : {}) } } : {}),
    };
    const [docs, total] = await Promise.all([
      this.prisma.rentalRequest.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: REQUEST_INCLUDE }),
      this.prisma.rentalRequest.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  async findOne(user: AuthUser, id: string) {
    const request = await this.prisma.rentalRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    if (!request) throw new NotFoundException('Rental request not found');
    const ownerId = resolveOwnerId(user);
    const allowed =
      isPlatformWide(user) ||
      (ownerId && request.unit.property.ownerId === ownerId) ||
      (user.role === UserRole.TENANT && request.tenantId === user.id);
    if (!allowed) throw new NotFoundException('Rental request not found');
    return request;
  }

  async cancel(user: AuthUser, id: string) {
    const request = await this.prisma.rentalRequest.findFirst({ where: { id, tenantId: user.id } });
    if (!request) throw new NotFoundException('Rental request not found');
    if (request.status !== RentalRequestStatus.PENDING) throw new BadRequestException('Only pending requests can be cancelled');
    const updated = await this.prisma.rentalRequest.update({
      where: { id },
      data: { status: RentalRequestStatus.CANCELLED, respondedAt: new Date() },
    });
    await this.audit.log(AUDIT_ACTIONS.RENTAL_REQUEST_CANCELLED, 'RentalRequest', id, user);
    return updated;
  }

  /** Accept → agreement generated (owner pre-signed), unit reserved, competing requests declined. */
  async accept(user: AuthUser, id: string, terms: LeaseTermsDto = {}) {
    const ownerId = requireOwnerId(user);
    const owner = await this.agreements.assertOwnerApproved(ownerId);
    const request = await this.prisma.rentalRequest.findUnique({
      where: { id },
      include: { unit: { include: { property: true } }, tenant: true },
    });
    if (!request || request.unit.property.ownerId !== ownerId) throw new NotFoundException('Rental request not found');
    if (request.status !== RentalRequestStatus.PENDING) throw new BadRequestException(`Request is ${request.status}`);
    if (request.unit.status !== UnitStatus.VACANT) throw new BadRequestException(`Unit is ${request.unit.status}`);
    if (request.tenant.isSuspended) throw new BadRequestException('Tenant account is suspended');

    const { agreement, declined } = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.unit.updateMany({
        where: { id: request.unitId, status: UnitStatus.VACANT },
        data: { status: UnitStatus.RESERVED },
      });
      if (claimed.count !== 1) throw new ConflictException('Unit was just reserved by another request');
      await tx.rentalRequest.update({
        where: { id },
        data: { status: RentalRequestStatus.ACCEPTED, respondedAt: new Date() },
      });
      const competing = await tx.rentalRequest.findMany({
        where: { unitId: request.unitId, status: RentalRequestStatus.PENDING, NOT: { id } },
        select: { id: true, tenantId: true },
      });
      await tx.rentalRequest.updateMany({
        where: { id: { in: competing.map((c) => c.id) } },
        data: { status: RentalRequestStatus.REJECTED, rejectionReason: 'Unit rented to another applicant', respondedAt: new Date() },
      });
      const created = await this.agreements.createFromRequest(tx, request, owner, terms);
      return { agreement: created, declined: competing };
    });

    await this.audit.log(AUDIT_ACTIONS.RENTAL_REQUEST_ACCEPTED, 'RentalRequest', id, user, { agreementId: agreement.id });
    const unitLabel = `${request.unit.property.name} ${request.unit.unitNumber}`;
    await this.notifications.notify([request.tenantId], 'RENTAL_REQUEST_ACCEPTED', { unit: unitLabel }, {
      sms: true,
      data: { rentalRequestId: id, agreementId: agreement.id },
    });
    if (declined.length) {
      await this.notifications.notify(declined.map((d) => d.tenantId), 'RENTAL_REQUEST_REJECTED', { unit: unitLabel });
    }
    await this.agreements.afterCreated(user, agreement);
    this.realtime.emitToUsers([request.tenantId, ownerId], REALTIME_EVENTS.RENTAL_REQUEST_UPDATED, { id, status: 'ACCEPTED' });
    return { rentalRequestId: id, agreement };
  }

  async reject(user: AuthUser, id: string, dto: RejectRentalRequestDto) {
    const ownerId = requireOwnerId(user);
    const request = await this.prisma.rentalRequest.findUnique({
      where: { id },
      include: { unit: { include: { property: true } } },
    });
    if (!request || request.unit.property.ownerId !== ownerId) throw new NotFoundException('Rental request not found');
    if (request.status !== RentalRequestStatus.PENDING) throw new BadRequestException(`Request is ${request.status}`);
    const updated = await this.prisma.rentalRequest.update({
      where: { id },
      data: { status: RentalRequestStatus.REJECTED, rejectionReason: dto.reason ?? null, respondedAt: new Date() },
    });
    await this.audit.log(AUDIT_ACTIONS.RENTAL_REQUEST_REJECTED, 'RentalRequest', id, user, { reason: dto.reason });
    await this.notifications.notify([request.tenantId], 'RENTAL_REQUEST_REJECTED', {
      unit: `${request.unit.property.name} ${request.unit.unitNumber}`,
    });
    this.realtime.emitToUsers([request.tenantId], REALTIME_EVENTS.RENTAL_REQUEST_UPDATED, updated);
    return updated;
  }
}
