import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ComplaintStatus, Prisma, WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { isPlatformStaff, requireOwnerId } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { roundMoney } from '../../../common/utils/money.util';
import { generateReference } from '../../../common/utils/reference.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { NotificationsService } from '../../core-services/notifications/notifications.service';
import { RealtimeGateway } from '../../core-services/realtime/realtime.gateway';
import { ExpensesService } from '../../billing/expenses/expenses.service';
import { CompleteWorkOrderDto, CreateWorkOrderDto, UpdateWorkOrderDto, WorkOrderFilterDto } from './dto/work-order.dto';

const CLOSED: WorkOrderStatus[] = [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED];

const WORK_ORDER_INCLUDE = {
  property: { select: { id: true, name: true } },
  unit: { select: { id: true, unitNumber: true } },
  vendor: { select: { id: true, name: true, phoneNumber: true, serviceType: true } },
  complaint: { select: { id: true, referenceNo: true, tenantId: true, status: true } },
} satisfies Prisma.WorkOrderInclude;

/** Work orders: assignment, status tracking, completion + cost logging (4.1.4). */
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly expenses: ExpensesService,
  ) {}

  async assertVendor(ownerId: string, vendorId?: string) {
    if (!vendorId) return;
    const vendor = await this.prisma.vendor.findFirst({ where: { id: vendorId, ownerId, isActive: true } });
    if (!vendor) throw new BadRequestException('Vendor not found or inactive');
  }

  async create(user: AuthUser, dto: CreateWorkOrderDto) {
    const ownerId = requireOwnerId(user);
    if (dto.clientRef) {
      const existing = await this.prisma.workOrder.findUnique({ where: { clientRef: dto.clientRef }, include: WORK_ORDER_INCLUDE });
      if (existing) return existing;
    }
    let propertyId = dto.propertyId;
    let unitId = dto.unitId ?? null;
    if (dto.complaintId) {
      const complaint = await this.prisma.complaint.findFirst({ where: { id: dto.complaintId, ownerId } });
      if (!complaint) throw new NotFoundException('Complaint not found');
      propertyId = complaint.propertyId;
      unitId = unitId ?? complaint.unitId;
    }
    if (!propertyId) throw new BadRequestException('propertyId or complaintId is required');
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, ownerId } });
    if (!property) throw new NotFoundException('Property not found');
    await this.assertVendor(ownerId, dto.vendorId);

    const workOrder = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workOrder.create({
        data: {
          referenceNo: generateReference('WO'),
          ownerId,
          propertyId,
          unitId,
          complaintId: dto.complaintId ?? null,
          vendorId: dto.vendorId ?? null,
          title: dto.title,
          description: dto.description,
          priority: dto.priority,
          estimatedCost: dto.estimatedCost,
          scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : null,
          photos: dto.photos ?? [],
          status: dto.vendorId ? WorkOrderStatus.ASSIGNED : WorkOrderStatus.OPEN,
          createdById: user.id,
          clientRef: dto.clientRef ?? null,
        },
        include: WORK_ORDER_INCLUDE,
      });
      if (dto.complaintId) {
        await tx.complaint.updateMany({
          where: { id: dto.complaintId, status: ComplaintStatus.OPEN },
          data: { status: ComplaintStatus.IN_PROGRESS },
        });
      }
      return created;
    });
    await this.audit.log(AUDIT_ACTIONS.WORK_ORDER_CREATED, 'WorkOrder', workOrder.id, user, { complaintId: dto.complaintId });
    await this.notifyTenant(workOrder);
    return workOrder;
  }

  async notifyTenant(workOrder: { id: string; referenceNo: string; status: WorkOrderStatus; ownerId: string; complaint?: { tenantId: string | null } | null }) {
    const tenantId = workOrder.complaint?.tenantId;
    if (tenantId) {
      await this.notifications.notify([tenantId], 'WORK_ORDER_UPDATED', {
        reference: workOrder.referenceNo,
        status: workOrder.status,
      }, { data: { workOrderId: workOrder.id } });
    }
    this.realtime.emitToUsers([workOrder.ownerId, tenantId], REALTIME_EVENTS.WORK_ORDER_UPDATED, workOrder);
  }

  async findAll(user: AuthUser, filter: WorkOrderFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.WorkOrderWhereInput = {
      ...(isPlatformStaff(user) ? {} : { ownerId: requireOwnerId(user) }),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
      ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
      ...(filter.complaintId ? { complaintId: filter.complaintId } : {}),
    };
    const [docs, total] = await Promise.all([
      this.prisma.workOrder.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: WORK_ORDER_INCLUDE }),
      this.prisma.workOrder.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  async findOne(user: AuthUser, id: string) {
    const workOrder = await this.prisma.workOrder.findFirst({
      where: { id, ...(isPlatformStaff(user) ? {} : { ownerId: requireOwnerId(user) }) },
      include: { ...WORK_ORDER_INCLUDE, expense: true },
    });
    if (!workOrder) throw new NotFoundException('Work order not found');
    return workOrder;
  }

  async update(user: AuthUser, id: string, dto: UpdateWorkOrderDto) {
    const workOrder = await this.findOne(user, id);
    if (CLOSED.includes(workOrder.status)) throw new BadRequestException(`Work order is ${workOrder.status}`);
    await this.assertVendor(workOrder.ownerId, dto.vendorId);
    const status = dto.status ?? (dto.vendorId && workOrder.status === WorkOrderStatus.OPEN ? WorkOrderStatus.ASSIGNED : undefined);
    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: {
        ...dto,
        status,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
      },
      include: WORK_ORDER_INCLUDE,
    });
    await this.audit.log(AUDIT_ACTIONS.WORK_ORDER_UPDATED, 'WorkOrder', id, user, { fields: Object.keys(dto) });
    if (status && status !== workOrder.status) await this.notifyTenant(updated);
    return updated;
  }

  /** Completes the job, logs the cost as a maintenance expense and resolves the linked complaint. */
  async complete(user: AuthUser, id: string, dto: CompleteWorkOrderDto) {
    const workOrder = await this.findOne(user, id);
    if (CLOSED.includes(workOrder.status)) throw new BadRequestException(`Work order is ${workOrder.status}`);
    const actualCost = roundMoney(dto.actualCost);
    const updated = await this.prisma.$transaction(async (tx) => {
      const done = await tx.workOrder.update({
        where: { id },
        data: {
          status: WorkOrderStatus.COMPLETED,
          actualCost,
          completionNotes: dto.completionNotes,
          completedAt: new Date(),
          photos: dto.photos?.length ? { push: dto.photos } : undefined,
        },
        include: WORK_ORDER_INCLUDE,
      });
      if (actualCost > 0) await this.expenses.createFromWorkOrder(tx, done, actualCost, user.id);
      if (done.complaintId) {
        await tx.complaint.updateMany({
          where: { id: done.complaintId, status: { in: [ComplaintStatus.OPEN, ComplaintStatus.IN_PROGRESS] } },
          data: { status: ComplaintStatus.RESOLVED, resolvedAt: new Date() },
        });
      }
      return done;
    });
    await this.audit.log(AUDIT_ACTIONS.WORK_ORDER_COMPLETED, 'WorkOrder', id, user, { actualCost });
    await this.notifyTenant(updated);
    return updated;
  }

  async cancel(user: AuthUser, id: string) {
    const workOrder = await this.findOne(user, id);
    if (CLOSED.includes(workOrder.status)) throw new BadRequestException(`Work order is ${workOrder.status}`);
    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: { status: WorkOrderStatus.CANCELLED },
      include: WORK_ORDER_INCLUDE,
    });
    await this.audit.log(AUDIT_ACTIONS.WORK_ORDER_UPDATED, 'WorkOrder', id, user, { status: 'CANCELLED' });
    await this.notifyTenant(updated);
    return updated;
  }
}
