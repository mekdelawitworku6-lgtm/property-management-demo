import { API, E2EContext, register, setupE2E } from '../e2e-helpers';

describe('Property & listings module (e2e)', () => {
  let ctx: E2EContext;
  let ownerId: string;
  let propertyId: string;
  let unitId: string;
  beforeAll(async () => {
    ctx = await setupE2E();
    ownerId = await register(ctx, 'owner', 'OWNER');
  });
  afterAll(() => ctx.close());

  it('owner registers residential/commercial/mixed-use properties with units', async () => {
    const property = await ctx.http().post(`${API}/properties`).set(ctx.auth('owner')).send({
      name: 'Bole Plaza', type: 'MIXED_USE', city: 'Addis Ababa', subCity: 'Bole', address: 'Bole Rd', amenities: ['Parking', 'Generator'],
    }).expect(201);
    propertyId = property.body.data.id;
    const apt = await ctx.http().post(`${API}/properties/${propertyId}/units`).set(ctx.auth('owner'))
      .send({ unitNumber: 'A-1', type: 'APARTMENT', bedrooms: 2, rentAmount: 15000, depositAmount: 30000 }).expect(201);
    unitId = apt.body.data.id;
    await ctx.http().post(`${API}/properties/${propertyId}/units`).set(ctx.auth('owner'))
      .send({ unitNumber: 'S-1', type: 'SHOP', rentAmount: 40000 }).expect(201);
    await ctx.http().post(`${API}/properties/${propertyId}/units`).set(ctx.auth('owner'))
      .send({ unitNumber: 'A-1', type: 'APARTMENT', rentAmount: 1 }).expect(409);
  });

  it('portfolio view shows unit occupancy summary', async () => {
    const res = await ctx.http().get(`${API}/properties`).set(ctx.auth('owner')).expect(200);
    expect(res.body.data.docs[0].unitSummary).toMatchObject({ total: 2, vacant: 2 });
  });

  it('listings hide pending owners, then filter by location, price and type once approved', async () => {
    let res = await ctx.http().get(`${API}/listings`).expect(200);
    expect(res.body.data.total).toBe(4); // seeded demo owner's units only
    await ctx.http().patch(`${API}/admin/users/${ownerId}/approve`).set(ctx.auth('admin')).expect(200);
    res = await ctx.http().get(`${API}/listings?subCity=Bole&unitType=APARTMENT&maxPrice=20000&minBedrooms=2`).expect(200);
    expect(res.body.data.docs.map((u: any) => u.id)).toContain(unitId);
    res = await ctx.http().get(`${API}/listings?propertyType=MIXED_USE&minPrice=30000`).expect(200);
    expect(res.body.data.docs.every((u: any) => u.rentAmount >= 30000)).toBe(true);
    const locations = await ctx.http().get(`${API}/listings/locations`).expect(200);
    expect(locations.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ city: 'Addis Ababa' })]));
  });

  it('units can be unlisted / put under maintenance but not manually occupied', async () => {
    await ctx.http().patch(`${API}/units/${unitId}`).set(ctx.auth('owner')).send({ status: 'OCCUPIED' }).expect(400);
    await ctx.http().patch(`${API}/units/${unitId}`).set(ctx.auth('owner')).send({ status: 'UNDER_MAINTENANCE' }).expect(200);
    await ctx.http().get(`${API}/listings/${unitId}`).expect(404);
  });

  it('other owners cannot see or edit the property; admin can see it', async () => {
    await register(ctx, 'other', 'OWNER');
    await ctx.http().get(`${API}/properties/${propertyId}`).set(ctx.auth('other')).expect(403);
    await ctx.http().patch(`${API}/properties/${propertyId}`).set(ctx.auth('other')).send({ name: 'Hijacked name' }).expect(403);
    await ctx.http().get(`${API}/properties/${propertyId}`).set(ctx.auth('admin')).expect(200);
  });
});
