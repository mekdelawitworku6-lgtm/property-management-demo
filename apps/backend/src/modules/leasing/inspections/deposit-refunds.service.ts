import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DepositRefundStatus, InspectionStatus, InspectionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS, type AuditAction } from '../../../common/constants/audit-actions.constants';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { isPlatformWide, requireOwnerId } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { roundMoney } from '../../../common/utils/money.util';
import { generateReference } from '../../../common/utils/reference.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { NotificationsService } from '../../core-services/notifications/notifications.service';
import { RealtimeGateway } from '../../core-services/realtime/realtime.gateway';
import {
  CreateDepositRefundDto,
  DecideDepositRefundDto,
  DepositRefundFilterDto,
  PayDepositRefundDto,
} from './dto/inspection.dto';

const REFUND_INCLUDE = {
  agreement: {
    select: {
      id: true,
      referenceNo: true,
      status: true,
      property: { select: { id: true, name: true } },
      unit: { select: { id: true, unitNumber: true } },
    },
  },
  tenant: { select: { id: true, fullName: true, phoneNumber: true } },
  inspection: { select: { id: true, referenceNo: true, type: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.DepositRefundInclude;

type RefundNotificationKey =
  | 'DEPOSIT_REFUND_APPROVED'
  | 'DEPOSIT_REFUND_PAID'
  | 'DEPOSIT_REFUND_REJECTED';

@Injectable()
export class DepositRefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private scope(user: AuthUser) {
    return isPlatformWide(user) ? {} : { ownerId: requireOwnerId(user) };
  }

  private unitLabel(refund: {
    agreement?: { property?: { name?: string } | null; unit?: { unitNumber?: string } | null } | null;
  }) {
    const property = refund.agreement?.property?.name ?? 'property';
    const unit = refund.agreement?.unit?.unitNumber ?? 'unit';
    return `${property} / ${unit}`;
  }

  private async notify(
    user: AuthUser,
    refund: {
      id: string;
      referenceNo: string;
      refundAmount: Prisma.Decimal;
      status: DepositRefundStatus;
      ownerId: string;
      tenantId: string;
      notes: string | null;
      agreement?: { property?: { name?: string } | null; unit?: { unitNumber?: string } | null } | null;
    },
    key: RefundNotificationKey,
    action: AuditAction,
  ) {
    await this.notifications.notify([refund.tenantId], key, {
      reference: refund.referenceNo,
      amount: Number(refund.refundAmount).toFixed(2),
      unit: this.unitLabel(refund),
      reason: refund.notes ?? 'No reason provided',
    }, { data: { depositRefundId: refund.id } });
    this.realtime.emitToUsers([refund.ownerId, refund.tenantId], REALTIME_EVENTS.DEPOSIT_REFUND_UPDATED, refund);
    await this.audit.log(action, 'DepositRefund', refund.id, user, {
      referenceNo: refund.referenceNo,
      status: refund.status,
    });
  }

  async create(user: AuthUser, dto: CreateDepositRefundDto) {
    const ownerId = requireOwnerId(user);
    if (dto.clientRef) {
      const existing = await this.prisma.depositRefund.findUnique({
        where: { clientRef: dto.clientRef },
        include: REFUND_INCLUDE,
      });
      if (existing) return existing;
    }
    const agreement = await this.prisma.agreement.findFirst({
      where: { id: dto.agreementId, ownerId },
      include: {
        property: { select: { id: true, name: true } },
        unit: { select: { id: true, unitNumber: true } },
      },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    const depositAmount = roundMoney(Number(agreement.depositAmount));
    if (depositAmount <= 0) throw new BadRequestException('This agreement has no security deposit');

    const duplicate = await this.prisma.depositRefund.findUnique({ where: { agreementId: agreement.id } });
    if (duplicate) throw new BadRequestException('A deposit refund already exists for this agreement');

    const deductions = roundMoney(dto.deductions ?? 0);
    if (deductions > 0 && !dto.inspectionId) {
      throw new BadRequestException('A completed move-out inspection is required when deducting from the deposit');
    }
    if (dto.inspectionId) {
      const inspection = await this.prisma.inspection.findFirst({
        where: {
          id: dto.inspectionId,
          agreementId: agreement.id,
          ownerId,
          type: InspectionType.MOVE_OUT,
          status: InspectionStatus.COMPLETED,
        },
      });
      if (!inspection) throw new NotFoundException('Completed move-out inspection not found');
    }
    const refundAmount = roundMoney(depositAmount - deductions);
    if (refundAmount < 0) throw new BadRequestException('Deductions cannot exceed the security deposit');

    const refund = await this.prisma.depositRefund.create({
      data: {
        referenceNo: generateReference('DRF'),
        agreementId: agreement.id,
        propertyId: agreement.propertyId,
        unitId: agreement.unitId,
        ownerId,
        tenantId: agreement.tenantId,
        inspectionId: dto.inspectionId ?? null,
        depositAmount,
        deductions,
        refundAmount,
        status: DepositRefundStatus.PENDING,
        notes: dto.notes,
        createdById: user.id,
        clientRef: dto.clientRef ?? null,
      },
      include: REFUND_INCLUDE,
    });
    await this.audit.log(AUDIT_ACTIONS.DEPOSIT_REFUND_CREATED, 'DepositRefund', refund.id, user, {
      referenceNo: refund.referenceNo,
      refundAmount,
    });
    this.realtime.emitToUsers([refund.ownerId, refund.tenantId], REALTIME_EVENTS.DEPOSIT_REFUND_UPDATED, refund);
    return refund;
  }

  async findAll(user: AuthUser, filter: DepositRefundFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.DepositRefundWhereInput = {
      ...this.scope(user),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.agreementId ? { agreementId: filter.agreementId } : {}),
    };
    const [docs, total] = await Promise.all([
      this.prisma.depositRefund.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: REFUND_INCLUDE,
      }),
      this.prisma.depositRefund.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  async findOne(user: AuthUser, id: string) {
    const refund = await this.prisma.depositRefund.findFirst({
      where: { id, ...this.scope(user) },
      include: REFUND_INCLUDE,
    });
    if (!refund) throw new NotFoundException('Deposit refund not found');
    return refund;
  }

  async approve(user: AuthUser, id: string, dto: DecideDepositRefundDto) {
    const refund = await this.findOne(user, id);
    if (refund.status !== DepositRefundStatus.PENDING) {
      throw new BadRequestException(`Deposit refund is ${refund.status}`);
    }
    const updated = await this.prisma.depositRefund.update({
      where: { id },
      data: {
        status: DepositRefundStatus.APPROVED,
        approvedById: user.id,
        notes: dto.notes ?? refund.notes,
      },
      include: REFUND_INCLUDE,
    });
    await this.notify(user, updated, 'DEPOSIT_REFUND_APPROVED', AUDIT_ACTIONS.DEPOSIT_REFUND_APPROVED);
    return updated;
  }

  async pay(user: AuthUser, id: string, dto: PayDepositRefundDto) {
    const refund = await this.findOne(user, id);
    if (refund.status !== DepositRefundStatus.APPROVED) {
      throw new BadRequestException(`Deposit refund must be approved before payment (currently ${refund.status})`);
    }
    const updated = await this.prisma.depositRefund.update({
      where: { id },
      data: {
        status: DepositRefundStatus.PAID,
        paidAt: new Date(),
        providerReference: dto.providerReference,
        notes: dto.notes ?? refund.notes,
      },
      include: REFUND_INCLUDE,
    });
    await this.notify(user, updated, 'DEPOSIT_REFUND_PAID', AUDIT_ACTIONS.DEPOSIT_REFUND_PAID);
    return updated;
  }

  async reject(user: AuthUser, id: string, dto: DecideDepositRefundDto) {
    const refund = await this.findOne(user, id);
    const decidableStatuses: DepositRefundStatus[] = [DepositRefundStatus.PENDING, DepositRefundStatus.APPROVED];
    if (!decidableStatuses.includes(refund.status)) {
      throw new BadRequestException(`Deposit refund is ${refund.status}`);
    }
    const updated = await this.prisma.depositRefund.update({
      where: { id },
      data: {
        status: DepositRefundStatus.REJECTED,
        notes: dto.notes ?? refund.notes,
      },
      include: REFUND_INCLUDE,
    });
    await this.notify(user, updated, 'DEPOSIT_REFUND_REJECTED', AUDIT_ACTIONS.DEPOSIT_REFUND_REJECTED);
    return updated;
  }
}
