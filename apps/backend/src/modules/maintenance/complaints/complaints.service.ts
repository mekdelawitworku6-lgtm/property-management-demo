import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgreementStatus, ComplaintStatus, EscalationStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { isPlatformStaff, isPlatformWide, requireOwnerId, resolveOwnerId } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { addDays } from '../../../common/utils/date.util';
import { generateReference } from '../../../common/utils/reference.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { NotificationsService } from '../../core-services/notifications/notifications.service';
import { RealtimeGateway } from '../../core-services/realtime/realtime.gateway';
import {
  AdminResolveComplaintDto, ComplaintFilterDto, CreateComplaintDto, EscalateComplaintDto, RespondComplaintDto, UpdateComplaintStatusDto,
} from './dto/complaint.dto';

const UNRESOLVED: ComplaintStatus[] = [ComplaintStatus.OPEN, ComplaintStatus.IN_PROGRESS];

/** Allowed status transitions for the owner side and for tenants. */
const OWNER_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  OPEN: [ComplaintStatus.IN_PROGRESS, ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED],
  IN_PROGRESS: [ComplaintStatus.RESOLVED, ComplaintStatus.OPEN],
  RESOLVED: [ComplaintStatus.CLOSED, ComplaintStatus.IN_PROGRESS],
  CLOSED: [],
};
const TENANT_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  OPEN: [ComplaintStatus.CLOSED],
  IN_PROGRESS: [],
  RESOLVED: [ComplaintStatus.CLOSED, ComplaintStatus.OPEN], // confirm fix or reopen
  CLOSED: [],
};

export function canTransition(role: UserRole, from: ComplaintStatus, to: ComplaintStatus): boolean {
  const map = role === UserRole.TENANT ? TENANT_TRANSITIONS : OWNER_TRANSITIONS;
  return map[from]?.includes(to) ?? false;
}

const COMPLAINT_INCLUDE = {
  property: { select: { id: true, name: true } },
  unit: { select: { id: true, unitNumber: true } },
  tenant: { select: { id: true, fullName: true, phoneNumber: true } },
  // `raisedBy` is who filed the report, which is not always the tenant: a manager
  // can raise it on a tenant's behalf. Both names are needed for attribution.
  raisedBy: { select: { id: true, fullName: true, role: true } },
  escalatedBy: { select: { id: true, fullName: true, role: true } },
} satisfies Prisma.ComplaintInclude;

/** Complaint / maintenance report lifecycle (FR-TEN-05/06, FR-OWN-05, FR-ADM-03, Section 3.4.2, 4.1.4). */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly configService: ConfigService,
  ) {}

  staleThreshold(now: Date = new Date()): Date {
    return addDays(now, -Number(this.configService.get('COMPLAINT_ESCALATION_DAYS', 7)));
  }

  /** 3.4.2: complaints become visible to Admin when escalated or left unresolved past the SLA. */
  adminVisibilityWhere(now: Date = new Date()): Prisma.ComplaintWhereInput {
    return {
      OR: [
        { escalationStatus: { not: EscalationStatus.NONE } },
        { status: { in: UNRESOLVED }, createdAt: { lt: this.staleThreshold(now) } },
      ],
    };
  }

  scopeWhere(user: AuthUser): Prisma.ComplaintWhereInput {
    if (isPlatformStaff(user)) return this.adminVisibilityWhere();
    // Staff the platform appointed directly are not triaging escalations, they
    // work the whole estate, so they see every owner's complaints rather than
    // the admin's escalated-only view.
    if (isPlatformWide(user)) return {};
    const ownerId = resolveOwnerId(user);
    return ownerId ? { ownerId } : { tenantId: user.id };
  }

  /** Resolves the target property/unit/agreement for a new complaint. */
  async resolveTarget(user: AuthUser, dto: CreateComplaintDto) {
    if (user.role === UserRole.TENANT) {
      const agreement = await this.prisma.agreement.findFirst({
        where: {
          tenantId: user.id,
          status: AgreementStatus.ACTIVE,
          ...(dto.agreementId ? { id: dto.agreementId } : {}),
          ...(dto.unitId ? { unitId: dto.unitId } : {}),
        },
        orderBy: { startDate: 'desc' },
      });
      if (!agreement) throw new BadRequestException('You need an active agreement to submit a complaint');
      return { tenantId: user.id, ownerId: agreement.ownerId, propertyId: agreement.propertyId, unitId: agreement.unitId, agreementId: agreement.id };
    }
    const ownerId = requireOwnerId(user);
    if (!dto.propertyId) throw new BadRequestException('propertyId is required');
    const property = await this.prisma.property.findFirst({ where: { id: dto.propertyId, ownerId } });
    if (!property) throw new NotFoundException('Property not found');
    let tenantId: string | null = null;
    let agreementId: string | null = null;
    if (dto.unitId) {
      const unit = await this.prisma.unit.findFirst({ where: { id: dto.unitId, propertyId: property.id } });
      if (!unit) throw new BadRequestException('Unit does not belong to the property');
      const active = await this.prisma.agreement.findFirst({ where: { unitId: unit.id, status: AgreementStatus.ACTIVE } });
      tenantId = active?.tenantId ?? null;
      agreementId = active?.id ?? null;
    }
    return { tenantId, ownerId, propertyId: property.id, unitId: dto.unitId ?? null, agreementId };
  }

  /** FR-TEN-05 / 4.1.4: tenant (or manager) raises a complaint / maintenance request. */
  async create(user: AuthUser, dto: CreateComplaintDto) {
    if (dto.clientRef) {
      const existing = await this.prisma.complaint.findUnique({ where: { clientRef: dto.clientRef }, include: COMPLAINT_INCLUDE });
      if (existing) return existing;
    }
    const target = await this.resolveTarget(user, dto);
    const complaint = await this.prisma.complaint.create({
      data: {
        ...target,
        referenceNo: generateReference('CMP'),
        raisedById: user.id,
        category: dto.category,
        priority: dto.priority,
        title: dto.title,
        description: dto.description,
        photos: dto.photos ?? [],
        clientRef: dto.clientRef ?? null,
      },
      include: COMPLAINT_INCLUDE,
    });
    await this.audit.log(AUDIT_ACTIONS.COMPLAINT_CREATED, 'Complaint', complaint.id, user, {
      category: complaint.category,
      priority: complaint.priority,
    });
    await this.notifications.notifyOwner(complaint.ownerId, 'COMPLAINT_NEW', {
      category: complaint.category,
      unit: complaint.unit?.unitNumber ?? complaint.property.name,
      title: complaint.title,
    }, { sms: complaint.priority === 'URGENT', data: { complaintId: complaint.id } });
    this.realtime.emitToUsers([complaint.ownerId, complaint.tenantId], REALTIME_EVENTS.COMPLAINT_UPDATED, complaint);
    return complaint;
  }

  async findAll(user: AuthUser, filter: ComplaintFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.ComplaintWhereInput = {
      AND: [
        this.scopeWhere(user),
        {
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.category ? { category: filter.category } : {}),
          ...(filter.priority ? { priority: filter.priority } : {}),
          ...(filter.escalationStatus ? { escalationStatus: filter.escalationStatus } : {}),
          ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
          ...(filter.staleOnly
            ? { status: { in: UNRESOLVED }, createdAt: { lt: this.staleThreshold() } }
            : {}),
        },
      ],
    };
    const [docs, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }],
        include: { ...COMPLAINT_INCLUDE, _count: { select: { responses: true, workOrders: true } } },
      }),
      this.prisma.complaint.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  /** Loads a complaint the user may see, throwing 404 otherwise. */
  async findVisible(user: AuthUser, id: string) {
    const complaint = await this.prisma.complaint.findFirst({
      where: { AND: [{ id }, this.scopeWhere(user)] },
      include: {
        ...COMPLAINT_INCLUDE,
        responses: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, fullName: true, role: true } } } },
        workOrders: { include: { vendor: { select: { id: true, name: true, phoneNumber: true } } } },
      },
    });
    if (!complaint) throw new NotFoundException('Complaint not found');
    return complaint;
  }

  /** FR-TEN-06: complaint status tracking with response thread. */
  findOne(user: AuthUser, id: string) {
    return this.findVisible(user, id);
  }

  async updateStatus(user: AuthUser, id: string, dto: UpdateComplaintStatusDto) {
    if (isPlatformStaff(user)) throw new ForbiddenException('Admins resolve disputes via admin-resolve');
    const complaint = await this.findVisible(user, id);
    if (complaint.status === dto.status) return complaint;
    if (!canTransition(user.role, complaint.status, dto.status)) {
      throw new BadRequestException(`Cannot change status from ${complaint.status} to ${dto.status}`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.note) {
        await tx.complaintResponse.create({ data: { complaintId: id, authorId: user.id, message: dto.note } });
      }
      return tx.complaint.update({
        where: { id },
        data: {
          status: dto.status,
          resolvedAt: dto.status === ComplaintStatus.RESOLVED ? new Date() : dto.status === ComplaintStatus.OPEN ? null : undefined,
        },
        include: COMPLAINT_INCLUDE,
      });
    });
    await this.audit.log(AUDIT_ACTIONS.COMPLAINT_STATUS_CHANGED, 'Complaint', id, user, { from: complaint.status, to: dto.status });
    const params = { reference: updated.referenceNo, status: updated.status };
    if (user.role === UserRole.TENANT) {
      await this.notifications.notifyOwner(updated.ownerId, 'COMPLAINT_UPDATED', params, { data: { complaintId: id } });
    } else {
      await this.notifications.notify([updated.tenantId], 'COMPLAINT_UPDATED', params, { sms: true, data: { complaintId: id } });
    }
    this.realtime.emitToUsers([updated.ownerId, updated.tenantId], REALTIME_EVENTS.COMPLAINT_UPDATED, updated);
    return updated;
  }

  /** FR-OWN-05: respond to a complaint (owner, tenant or admin on escalated disputes). */
  async respond(user: AuthUser, id: string, dto: RespondComplaintDto) {
    const complaint = await this.findVisible(user, id);
    if (complaint.status === ComplaintStatus.CLOSED) throw new BadRequestException('Complaint is closed');
    const response = await this.prisma.complaintResponse.create({
      data: { complaintId: id, authorId: user.id, message: dto.message, attachments: dto.attachments ?? [] },
      include: { author: { select: { id: true, fullName: true, role: true } } },
    });
    if (complaint.status === ComplaintStatus.OPEN && resolveOwnerId(user)) {
      await this.prisma.complaint.update({ where: { id }, data: { status: ComplaintStatus.IN_PROGRESS } });
    }
    await this.audit.log(AUDIT_ACTIONS.COMPLAINT_RESPONDED, 'Complaint', id, user);
    const params = { reference: complaint.referenceNo };
    if (user.role === UserRole.TENANT) {
      await this.notifications.notifyOwner(complaint.ownerId, 'COMPLAINT_RESPONSE', params, { data: { complaintId: id } });
    } else {
      await this.notifications.notify([complaint.tenantId], 'COMPLAINT_RESPONSE', params, { data: { complaintId: id } });
      if (isPlatformStaff(user)) {
        await this.notifications.notifyOwner(complaint.ownerId, 'COMPLAINT_RESPONSE', params, { data: { complaintId: id } });
      }
    }
    this.realtime.emitToUsers([complaint.ownerId, complaint.tenantId], REALTIME_EVENTS.COMPLAINT_UPDATED, { id, response });
    return response;
  }

  /** FR-OWN-05 / 6.1: owner or tenant escalates to the platform admin. */
  async escalate(user: AuthUser, id: string, dto: EscalateComplaintDto) {
    if (isPlatformStaff(user)) throw new ForbiddenException('Only the owner or tenant can escalate');
    const complaint = await this.findVisible(user, id);
    if (complaint.escalationStatus !== EscalationStatus.NONE) throw new BadRequestException('Complaint already escalated');
    if (complaint.status === ComplaintStatus.CLOSED) throw new BadRequestException('Complaint is closed');
    const updated = await this.prisma.complaint.update({
      where: { id },
      data: {
        escalationStatus: EscalationStatus.ESCALATED,
        escalatedAt: new Date(),
        escalatedById: user.id,
        escalationReason: dto.reason,
      },
      include: COMPLAINT_INCLUDE,
    });
    await this.audit.log(AUDIT_ACTIONS.COMPLAINT_ESCALATED, 'Complaint', id, user, { reason: dto.reason });
    const params = { reference: updated.referenceNo };
    await this.notifications.notifyStaff('COMPLAINT_ESCALATED', params, [UserRole.ADMIN], { data: { complaintId: id } });
    await this.notifications.notify([updated.tenantId], 'COMPLAINT_ESCALATED', params);
    await this.notifications.notifyOwner(updated.ownerId, 'COMPLAINT_ESCALATED', params);
    this.realtime.emitToStaff(REALTIME_EVENTS.COMPLAINT_UPDATED, updated);
    this.realtime.emitToUsers([updated.ownerId, updated.tenantId], REALTIME_EVENTS.COMPLAINT_UPDATED, updated);
    return updated;
  }

  /** FR-ADM-03: admin decides a dispute escalated beyond the owner level. */
  async adminResolve(user: AuthUser, id: string, dto: AdminResolveComplaintDto) {
    const complaint = await this.findVisible(user, id);
    if (complaint.escalationStatus === EscalationStatus.ADMIN_RESOLVED) {
      throw new BadRequestException('Complaint already resolved by admin');
    }
    const status = dto.status ?? ComplaintStatus.RESOLVED;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.complaintResponse.create({
        data: { complaintId: id, authorId: user.id, message: `[Admin resolution] ${dto.resolution}` },
      });
      return tx.complaint.update({
        where: { id },
        data: {
          escalationStatus: EscalationStatus.ADMIN_RESOLVED,
          adminResolution: dto.resolution,
          status,
          resolvedAt: new Date(),
          ...(complaint.escalationStatus === EscalationStatus.NONE
            ? { escalatedAt: new Date(), escalatedById: user.id, escalationReason: 'Admin intervention on unresolved complaint' }
            : {}),
        },
        include: COMPLAINT_INCLUDE,
      });
    });
    await this.audit.log(AUDIT_ACTIONS.COMPLAINT_ADMIN_RESOLVED, 'Complaint', id, user, { resolution: dto.resolution });
    const params = { reference: updated.referenceNo, status: updated.status };
    await this.notifications.notify([updated.tenantId], 'COMPLAINT_UPDATED', params, { sms: true, data: { complaintId: id } });
    await this.notifications.notifyOwner(updated.ownerId, 'COMPLAINT_UPDATED', params, { data: { complaintId: id } });
    this.realtime.emitToUsers([updated.ownerId, updated.tenantId], REALTIME_EVENTS.COMPLAINT_UPDATED, updated);
    return updated;
  }
}
