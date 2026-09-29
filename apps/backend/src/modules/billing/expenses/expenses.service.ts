import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { isPlatformStaff, requireOwnerId } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { sumMoney } from '../../../common/utils/money.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { CreateExpenseDto, ExpenseFilterDto, UpdateExpenseDto } from './dto/expense.dto';

/** Property expenses feeding owner statements (income − expenses = net). */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async assertPropertyUnit(ownerId: string, propertyId: string, unitId?: string) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, ownerId } });
    if (!property) throw new NotFoundException('Property not found');
    if (unitId) {
      const unit = await this.prisma.unit.findFirst({ where: { id: unitId, propertyId } });
      if (!unit) throw new BadRequestException('Unit does not belong to the property');
    }
  }

  async create(user: AuthUser, dto: CreateExpenseDto) {
    const ownerId = requireOwnerId(user);
    await this.assertPropertyUnit(ownerId, dto.propertyId, dto.unitId);
    const expense = await this.prisma.expense.create({
      data: { ...dto, ownerId, incurredOn: new Date(dto.incurredOn), recordedById: user.id },
    });
    await this.audit.log(AUDIT_ACTIONS.EXPENSE_RECORDED, 'Expense', expense.id, user, { amount: dto.amount, category: dto.category });
    return expense;
  }

  /** Records the maintenance cost of a completed work order (inside its transaction). */
  createFromWorkOrder(
    tx: Prisma.TransactionClient,
    workOrder: { id: string; ownerId: string; propertyId: string; unitId: string | null; title: string; referenceNo: string },
    amount: number,
    recordedById: string,
  ) {
    return tx.expense.upsert({
      where: { workOrderId: workOrder.id },
      update: { amount },
      create: {
        ownerId: workOrder.ownerId,
        propertyId: workOrder.propertyId,
        unitId: workOrder.unitId,
        workOrderId: workOrder.id,
        category: ExpenseCategory.MAINTENANCE,
        amount,
        description: `Work order ${workOrder.referenceNo}: ${workOrder.title}`,
        incurredOn: new Date(),
        recordedById,
      },
    });
  }

  async findAll(user: AuthUser, filter: ExpenseFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.ExpenseWhereInput = {
      ...(isPlatformStaff(user) ? {} : { ownerId: requireOwnerId(user) }),
      ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.from || filter.to
        ? {
            incurredOn: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(filter.to) } : {}),
            },
          }
        : {}),
    };
    const [docs, total, sum] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        skip,
        take,
        orderBy: { incurredOn: 'desc' },
        include: { property: { select: { id: true, name: true } }, unit: { select: { id: true, unitNumber: true } } },
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    return { ...buildPaginatedList(docs, { page, limit, total }), totalAmount: sumMoney([sum._sum.amount]) };
  }

  async findOwned(user: AuthUser, id: string) {
    const expense = await this.prisma.expense.findFirst({ where: { id, ownerId: requireOwnerId(user) } });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  async update(user: AuthUser, id: string, dto: UpdateExpenseDto) {
    const expense = await this.findOwned(user, id);
    if (expense.workOrderId) throw new BadRequestException('Work-order expenses are updated through the work order');
    if (dto.propertyId || dto.unitId) {
      await this.assertPropertyUnit(expense.ownerId, dto.propertyId ?? expense.propertyId, dto.unitId);
    }
    const updated = await this.prisma.expense.update({
      where: { id },
      data: { ...dto, ...(dto.incurredOn ? { incurredOn: new Date(dto.incurredOn) } : {}) },
    });
    await this.audit.log(AUDIT_ACTIONS.EXPENSE_UPDATED, 'Expense', id, user, { fields: Object.keys(dto) });
    return updated;
  }

  async remove(user: AuthUser, id: string) {
    const expense = await this.findOwned(user, id);
    if (expense.workOrderId) throw new BadRequestException('Work-order expenses cannot be deleted');
    await this.prisma.expense.delete({ where: { id } });
    await this.audit.log(AUDIT_ACTIONS.EXPENSE_DELETED, 'Expense', id, user, { amount: expense.amount });
    return { deleted: true };
  }
}
