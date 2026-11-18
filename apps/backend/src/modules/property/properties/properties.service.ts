import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AgreementStatus, Prisma, UnitStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { assertCanAccess, isPlatformWide, requireOwnerId } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { CreatePropertyDto, PropertyFilterDto, UpdatePropertyDto } from './dto/property.dto';

/** Counts units by status for a property summary. */
export function summarizeUnits(units: Array<{ status: UnitStatus }>) {
  const summary = { total: units.length, vacant: 0, reserved: 0, occupied: 0, underMaintenance: 0 };
  for (const unit of units) {
    if (unit.status === UnitStatus.VACANT) summary.vacant++;
    else if (unit.status === UnitStatus.RESERVED) summary.reserved++;
    else if (unit.status === UnitStatus.OCCUPIED) summary.occupied++;
    else if (unit.status === UnitStatus.UNDER_MAINTENANCE) summary.underMaintenance++;
  }
  return summary;
}

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** FR-OWN-02: register a property (residential, commercial or mixed-use). */
  async create(user: AuthUser, dto: CreatePropertyDto) {
    const ownerId = requireOwnerId(user);
    const property = await this.prisma.property.create({ data: { ...dto, ownerId } });
    await this.audit.log(AUDIT_ACTIONS.PROPERTY_CREATED, 'Property', property.id, user, { name: property.name });
    return property;
  }

  /** Multi-property portfolio view (owner/manager) or platform-wide (staff). */
  async findAll(user: AuthUser, filter: PropertyFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.PropertyWhereInput = {
      ...(isPlatformWide(user) ? (filter.ownerId ? { ownerId: filter.ownerId } : {}) : { ownerId: requireOwnerId(user) }),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.city ? { city: { equals: filter.city, mode: 'insensitive' } } : {}),
      isActive: filter.isActive ?? true,
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { address: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [properties, total] = await Promise.all([
      this.prisma.property.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { units: { select: { status: true } } },
      }),
      this.prisma.property.count({ where }),
    ]);
    const docs = properties.map(({ units, ...p }) => ({ ...p, unitSummary: summarizeUnits(units) }));
    return buildPaginatedList(docs, { page, limit, total });
  }

  async findOne(user: AuthUser, id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        units: { orderBy: { unitNumber: 'asc' } },
        owner: { select: { id: true, fullName: true, phoneNumber: true } },
        agreements: {
          where: { status: { in: [AgreementStatus.ACTIVE, AgreementStatus.PENDING_SIGNATURE] } },
          include: { tenant: { select: { id: true, fullName: true, phoneNumber: true } } },
        },
      },
    });
    if (!property) throw new NotFoundException('Property not found');
    assertCanAccess(user, property);
    return { ...property, unitSummary: summarizeUnits(property.units) };
  }

  async update(user: AuthUser, id: string, dto: UpdatePropertyDto) {
    await this.findOwned(user, id);
    const property = await this.prisma.property.update({ where: { id }, data: dto });
    await this.audit.log(AUDIT_ACTIONS.PROPERTY_UPDATED, 'Property', id, user, { fields: Object.keys(dto) });
    return property;
  }

  /** Soft-deactivates a property; blocked while any agreement is active or pending. */
  async deactivate(user: AuthUser, id: string) {
    await this.findOwned(user, id);
    const activeAgreements = await this.prisma.agreement.count({
      where: { propertyId: id, status: { in: [AgreementStatus.ACTIVE, AgreementStatus.PENDING_SIGNATURE] } },
    });
    if (activeAgreements > 0) {
      throw new BadRequestException('Cannot deactivate a property with active or pending agreements');
    }
    const property = await this.prisma.$transaction(async (tx) => {
      await tx.unit.updateMany({ where: { propertyId: id }, data: { isListed: false } });
      return tx.property.update({ where: { id }, data: { isActive: false } });
    });
    await this.audit.log(AUDIT_ACTIONS.PROPERTY_DEACTIVATED, 'Property', id, user);
    return property;
  }

  /** Loads a property the caller's owner-scope owns (throws 404/403 otherwise). */
  async findOwned(user: AuthUser, id: string) {
    const property = await this.prisma.property.findUnique({ where: { id } });
    if (!property) throw new NotFoundException('Property not found');
    assertCanAccess(user, property);
    if (!isPlatformWide(user)) requireOwnerId(user);
    return property;
  }
}
