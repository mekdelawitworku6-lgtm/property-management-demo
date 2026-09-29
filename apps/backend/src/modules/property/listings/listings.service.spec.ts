import { NotFoundException } from '@nestjs/common';
import { createPrismaMock } from '../../../test-utils/mocks';
import { AVAILABLE_UNIT_WHERE, ListingsService, buildListingWhere, listingOrderBy } from './listings.service';

describe('ListingsService', () => {
  const prisma = createPrismaMock();
  const service = new ListingsService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('AVAILABLE_UNIT_WHERE requires vacant, listed, active, approved owner', () => {
    expect(AVAILABLE_UNIT_WHERE).toMatchObject({
      status: 'VACANT', isListed: true, property: { isActive: true, owner: { approvalStatus: 'APPROVED', isSuspended: false } },
    });
  });

  it('buildListingWhere applies location, type, price, bedroom and text filters', () => {
    const where: any = buildListingWhere({ city: 'Addis Ababa', subCity: 'Bole', propertyType: 'RESIDENTIAL', unitType: 'APARTMENT', minPrice: 5000, maxPrice: 20000, minBedrooms: 2, search: 'edna' });
    expect(where).toMatchObject({ status: 'VACANT', type: 'APARTMENT', bedrooms: { gte: 2 }, rentAmount: { gte: 5000, lte: 20000 } });
    expect(where.property).toMatchObject({ type: 'RESIDENTIAL', city: { equals: 'Addis Ababa', mode: 'insensitive' }, isActive: true });
    expect(where.property.OR).toHaveLength(3);
    expect(buildListingWhere({})).not.toHaveProperty('rentAmount');
  });

  it('listingOrderBy maps sort keys', () => {
    expect(listingOrderBy('price_asc')).toEqual({ rentAmount: 'asc' });
    expect(listingOrderBy('price_desc')).toEqual({ rentAmount: 'desc' });
    expect(listingOrderBy()).toEqual({ createdAt: 'desc' });
  });

  it('search paginates results', async () => {
    prisma.unit.findMany.mockResolvedValue([{ id: 'u' }]);
    prisma.unit.count.mockResolvedValue(1);
    await expect(service.search({ page: 1, limit: 5 })).resolves.toMatchObject({ docs: [{ id: 'u' }], total: 1, limit: 5 });
  });

  it('findOne returns an available unit or 404', async () => {
    prisma.unit.findFirst.mockResolvedValueOnce({ id: 'u' });
    await expect(service.findOne('u')).resolves.toEqual({ id: 'u' });
    prisma.unit.findFirst.mockResolvedValueOnce(null);
    await expect(service.findOne('u')).rejects.toThrow(NotFoundException);
  });

  it('locations groups sub-cities by city', async () => {
    prisma.property.findMany.mockResolvedValue([
      { city: 'Addis Ababa', subCity: 'Bole' }, { city: 'Addis Ababa', subCity: 'Yeka' }, { city: 'Hawassa', subCity: null },
    ]);
    await expect(service.locations()).resolves.toEqual([
      { city: 'Addis Ababa', subCities: ['Bole', 'Yeka'] }, { city: 'Hawassa', subCities: [] },
    ]);
  });
});
