import { Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, Prisma, UnitStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { ListingFilterDto } from './dto/listing-filter.dto';

/** Only vacant, listed units of active properties owned by approved, non-suspended owners are browsable. */
export const AVAILABLE_UNIT_WHERE: Prisma.UnitWhereInput = {
  status: UnitStatus.VACANT,
  isListed: true,
  property: {
    isActive: true,
    owner: { approvalStatus: ApprovalStatus.APPROVED, isSuspended: false },
  },
};

export function buildListingWhere(filter: ListingFilterDto): Prisma.UnitWhereInput {
  const property: Prisma.PropertyWhereInput = { ...(AVAILABLE_UNIT_WHERE.property as Prisma.PropertyWhereInput) };
  if (filter.city) property.city = { equals: filter.city, mode: 'insensitive' };
  if (filter.subCity) property.subCity = { equals: filter.subCity, mode: 'insensitive' };
  if (filter.propertyType) property.type = filter.propertyType;
  if (filter.search) {
    property.OR = [
      { name: { contains: filter.search, mode: 'insensitive' } },
      { address: { contains: filter.search, mode: 'insensitive' } },
      { subCity: { contains: filter.search, mode: 'insensitive' } },
    ];
  }
  const rent: Prisma.DecimalFilter = {};
  if (filter.minPrice !== undefined) rent.gte = filter.minPrice;
  if (filter.maxPrice !== undefined) rent.lte = filter.maxPrice;

  return {
    ...AVAILABLE_UNIT_WHERE,
    property,
    ...(filter.unitType ? { type: filter.unitType } : {}),
    ...(filter.minBedrooms !== undefined ? { bedrooms: { gte: filter.minBedrooms } } : {}),
    ...(Object.keys(rent).length ? { rentAmount: rent } : {}),
  };
}

export function listingOrderBy(sort?: string): Prisma.UnitOrderByWithRelationInput {
  if (sort === 'price_asc') return { rentAmount: 'asc' };
  if (sort === 'price_desc') return { rentAmount: 'desc' };
  return { createdAt: 'desc' };
}

const LISTING_PROPERTY_SELECT = {
  id: true,
  name: true,
  type: true,
  city: true,
  subCity: true,
  woreda: true,
  address: true,
  latitude: true,
  longitude: true,
  amenities: true,
  photos: true,
  description: true,
  owner: { select: { id: true, fullName: true } },
} satisfies Prisma.PropertySelect;

/** FR-TEN-01: browse available properties filterable by location, price or type. */
@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(filter: ListingFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where = buildListingWhere(filter);
    const [docs, total] = await Promise.all([
      this.prisma.unit.findMany({
        where,
        skip,
        take,
        orderBy: listingOrderBy(filter.sort),
        include: { property: { select: LISTING_PROPERTY_SELECT } },
      }),
      this.prisma.unit.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  async findOne(unitId: string) {
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, ...AVAILABLE_UNIT_WHERE },
      include: { property: { select: LISTING_PROPERTY_SELECT } },
    });
    if (!unit) throw new NotFoundException('Listing not found or no longer available');
    return unit;
  }

  /** Distinct cities / sub-cities with available units (for filter dropdowns). */
  async locations() {
    const rows = await this.prisma.property.findMany({
      where: { isActive: true, units: { some: { status: UnitStatus.VACANT, isListed: true } } },
      select: { city: true, subCity: true },
      distinct: ['city', 'subCity'],
      orderBy: [{ city: 'asc' }, { subCity: 'asc' }],
    });
    const map = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!map.has(row.city)) map.set(row.city, new Set());
      if (row.subCity) map.get(row.city).add(row.subCity);
    }
    return [...map.entries()].map(([city, subCities]) => ({ city, subCities: [...subCities] }));
  }
}
