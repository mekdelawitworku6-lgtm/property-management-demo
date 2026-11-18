import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WorkOrderStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { isPlatformWide, requireOwnerId } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { normalizeEthiopianPhone } from '../../../common/utils/phone.util';
import { sumMoney } from '../../../common/utils/money.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { CreateVendorDto, UpdateVendorDto, VendorFilterDto } from './dto/vendor.dto';

/** Vendor / contractor directory per owner (4.1.4). */
@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  normalizePhone(phone: string): string {
    const normalized = normalizeEthiopianPhone(phone);
    if (!normalized) throw new BadRequestException('Invalid Ethiopian phone number');
    return normalized;
  }

  async create(user: AuthUser, dto: CreateVendorDto) {
    const ownerId = requireOwnerId(user);
    const vendor = await this.prisma.vendor.create({
      data: { ...dto, phoneNumber: this.normalizePhone(dto.phoneNumber), ownerId },
    });
    await this.audit.log(AUDIT_ACTIONS.VENDOR_CREATED, 'Vendor', vendor.id, user);
    return vendor;
  }

  async findAll(user: AuthUser, filter: VendorFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.VendorWhereInput = {
      ...(isPlatformWide(user) ? {} : { ownerId: requireOwnerId(user) }),
      isActive: filter.isActive ?? true,
      ...(filter.serviceType ? { serviceType: filter.serviceType } : {}),
      ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
    };
    const [docs, total] = await Promise.all([
      this.prisma.vendor.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      this.prisma.vendor.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  /** Vendor with work-order history and total spend. */
  async findOne(user: AuthUser, id: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, ...(isPlatformWide(user) ? {} : { ownerId: requireOwnerId(user) }) },
      include: { workOrders: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const completed = vendor.workOrders.filter((w) => w.status === WorkOrderStatus.COMPLETED);
    return { ...vendor, totalSpend: sumMoney(completed.map((w) => w.actualCost)), completedJobs: completed.length };
  }

  async update(user: AuthUser, id: string, dto: UpdateVendorDto) {
    const vendor = await this.prisma.vendor.findFirst({ where: { id, ownerId: requireOwnerId(user) } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const updated = await this.prisma.vendor.update({
      where: { id },
      data: { ...dto, ...(dto.phoneNumber ? { phoneNumber: this.normalizePhone(dto.phoneNumber) } : {}) },
    });
    await this.audit.log(AUDIT_ACTIONS.VENDOR_UPDATED, 'Vendor', id, user, { fields: Object.keys(dto) });
    return updated;
  }
}
