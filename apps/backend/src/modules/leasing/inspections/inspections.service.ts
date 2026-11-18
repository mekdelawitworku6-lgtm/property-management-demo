import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DepositRefundStatus, InspectionStatus, InspectionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { isPlatformWide, requireOwnerId } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { roundMoney } from '../../../common/utils/money.util';
import { generateReference } from '../../../common/utils/reference.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { NotificationsService } from '../../core-services/notifications/notifications.service';
import { RealtimeGateway } from '../../core-services/realtime/realtime.gateway';
import {
  CompleteInspectionDto,
  CreateInspectionDto,
  InspectionFilterDto,
} from './dto/inspection.dto';

const CLOSED: InspectionStatus[] = [InspectionStatus.COMPLETED, InspectionStatus.CANCELLED];

const INSPECTION_INCLUDE = {
  agreement: {
    select: {
      id: true,
      referenceNo: true,
      status: true,
      endDate: true,
      property: { select: { id: true, name: true } },
      unit: { select: { id: true, unitNumber: true } },
    },
  },
  tenant: { select: { id: true, fullName: true, phoneNumber: true } },
  conductedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.InspectionInclude;

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private scope(user: AuthUser) {
    return isPlatformWide(user) ? {} : { ownerId: requireOwnerId(user) };
  }

  private unitLabel(inspection: {
    agreement?: { property?: { name?: string } | null; unit?: { unitNumber?: string } | null } | null;
  }) {
    const property = inspection.agreement?.property?.name ?? 'property';
    const unit = inspection.agreement?.unit?.unitNumber ?? 'unit';
    return `${property} / ${unit}`;
  }

  private async notify(user: AuthUser, inspection: {
    id: string;
    referenceNo: string;
    type: InspectionType;
    status: InspectionStatus;
    ownerId: string;
    tenantId: string;
    scheduledAt: Date | null;
    agreement?: { property?: { name?: string } | null; unit?: { unitNumber?: string } | null } | null;
  }, key: 'INSPECTION_SCHEDULED' | 'INSPECTION_COMPLETED') {
    await this.notifications.notify([inspection.tenantId], key, {
      reference: inspection.referenceNo,
      type: inspection.type === InspectionType.MOVE_IN ? 'move-in' : 'move-out',
      unit: this.unitLabel(inspection),
      date: inspection.scheduledAt?.toISOString() ?? new Date().toISOString(),
    }, { data: { inspectionId: inspection.id } });
    this.realtime.emitToUsers([inspection.ownerId, inspection.tenantId], REALTIME_EVENTS.INSPECTION_UPDATED, inspection);
    await this.audit.log(
      key === 'INSPECTION_SCHEDULED' ? AUDIT_ACTIONS.INSPECTION_CREATED : AUDIT_ACTIONS.INSPECTION_COMPLETED,
      'Inspection',
      inspection.id,
      user,
      { referenceNo: inspection.referenceNo, status: inspection.status },
    );
  }

  async create(user: AuthUser, dto: CreateInspectionDto) {
    const ownerId = requireOwnerId(user);
    if (dto.clientRef) {
      const existing = await this.prisma.inspection.findUnique({
        where: { clientRef: dto.clientRef },
        include: INSPECTION_INCLUDE,
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

    const inspection = await this.prisma.inspection.create({
      data: {
        referenceNo: generateReference('INS'),
        agreementId: agreement.id,
        propertyId: agreement.propertyId,
        unitId: agreement.unitId,
        ownerId,
        tenantId: agreement.tenantId,
        type: dto.type,
        status: InspectionStatus.SCHEDULED,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        items: dto.items ? (dto.items as unknown as Prisma.InputJsonValue) : undefined,
        photos: dto.photos ?? [],
        notes: dto.notes,
        clientRef: dto.clientRef ?? null,
      },
      include: INSPECTION_INCLUDE,
    });
    await this.notify(user, inspection, 'INSPECTION_SCHEDULED');
    return inspection;
  }

  async findAll(user: AuthUser, filter: InspectionFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.InspectionWhereInput = {
      ...this.scope(user),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.agreementId ? { agreementId: filter.agreementId } : {}),
    };
    const [docs, total] = await Promise.all([
      this.prisma.inspection.findMany({
        where,
        skip,
        take,
        orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
        include: INSPECTION_INCLUDE,
      }),
      this.prisma.inspection.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  async findOne(user: AuthUser, id: string) {
    const inspection = await this.prisma.inspection.findFirst({
      where: { id, ...this.scope(user) },
      include: INSPECTION_INCLUDE,
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    return inspection;
  }

  async complete(user: AuthUser, id: string, dto: CompleteInspectionDto) {
    const inspection = await this.findOne(user, id);
    if (inspection.status !== InspectionStatus.SCHEDULED) {
      throw new BadRequestException(`Inspection is ${inspection.status}`);
    }
    const updated = await this.prisma.inspection.update({
      where: { id },
      data: {
        status: InspectionStatus.COMPLETED,
        completedAt: new Date(),
        conductedById: user.id,
        items: dto.items ? (dto.items as unknown as Prisma.InputJsonValue) : undefined,
        notes: dto.notes ?? inspection.notes,
        photos: dto.photos?.length ? { push: dto.photos } : undefined,
      },
      include: INSPECTION_INCLUDE,
    });
    await this.notify(user, updated, 'INSPECTION_COMPLETED');
    return updated;
  }

  async cancel(user: AuthUser, id: string) {
    const inspection = await this.findOne(user, id);
    if (CLOSED.includes(inspection.status)) {
      throw new BadRequestException(`Inspection is ${inspection.status}`);
    }
    const updated = await this.prisma.inspection.update({
      where: { id },
      data: { status: InspectionStatus.CANCELLED },
      include: INSPECTION_INCLUDE,
    });
    await this.audit.log(AUDIT_ACTIONS.INSPECTION_CANCELLED, 'Inspection', id, user, {
      referenceNo: updated.referenceNo,
    });
    this.realtime.emitToUsers([updated.ownerId, updated.tenantId], REALTIME_EVENTS.INSPECTION_UPDATED, updated);
    return updated;
  }
}
