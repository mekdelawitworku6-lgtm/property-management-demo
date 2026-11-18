/**
 * Idempotent demo seed (existing rows are skipped / updated in place).
 * Run inside Docker: `docker compose run --rm seed` (or it runs automatically on `docker compose up`).
 */
import {
  AgreementStatus,
  ApprovalStatus,
  InvoiceStatus,
  InvoiceType,
  Language,
  PrismaClient,
  PropertyType,
  UnitStatus,
  UnitType,
  UserRole,
  VendorServiceType,
} from '@prisma/client';
import { hashPassword } from '../../common/utils/password.util';
import { ALL_MANAGER_PERMISSIONS } from '../../common/constants/manager-permissions.constants';
import { buildAgreementContent, computeEndDate, hashContent } from '../../modules/leasing/agreements/utils/agreement-content.util';
import {
  buildDepositInvoiceDraft,
  buildRentInvoiceDrafts,
  invoiceKey,
  type InvoiceDraft,
} from '../../modules/billing/invoices/utils/billing-period.util';
import { generateReference } from '../../common/utils/reference.util';

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Demo@12345';

export const SEED_USERS = [
  { key: 'admin', role: UserRole.ADMIN, fullName: 'Platform Admin (Possible Technology)', phoneNumber: '+251911000001', email: 'admin@possibletech.et' },
  { key: 'telecom', role: UserRole.TELECOM, fullName: 'Ethio Telecom Payments', phoneNumber: '+251911000002', email: 'payments@ethiotelecom.et' },
  { key: 'owner', role: UserRole.OWNER, fullName: 'Abebe Kebede', phoneNumber: '+251911000003', email: 'owner@demo.et' },
  { key: 'manager', role: UserRole.MANAGER, fullName: 'Sara Alemu', phoneNumber: '+251911000004', email: 'manager@demo.et' },
  { key: 'tenant', role: UserRole.TENANT, fullName: 'Meron Tadesse', phoneNumber: '+251911000005', email: 'tenant@demo.et' },
] as const;

async function upsertUser(prisma: PrismaClient, passwordHash: string, seed: (typeof SEED_USERS)[number], employerId?: string) {
  // Demo staff gets every grant so the seeded manager account keeps working;
  // owners restrict real staff through the "add staff" screen instead.
  const isManager = seed.role === UserRole.MANAGER;
  return prisma.user.upsert({
    where: { phoneNumber: seed.phoneNumber },
    update: isManager ? { permissions: { set: [...ALL_MANAGER_PERMISSIONS] } } : {},
    create: {
      role: seed.role,
      fullName: seed.fullName,
      phoneNumber: seed.phoneNumber,
      email: seed.email,
      passwordHash,
      approvalStatus: ApprovalStatus.APPROVED,
      phoneVerified: true,
      language: seed.role === UserRole.TENANT ? Language.AM : Language.EN,
      employerId: employerId ?? null,
      ...(isManager ? { permissions: { set: [...ALL_MANAGER_PERMISSIONS] } } : {}),
      ...(seed.role === UserRole.OWNER
        ? { ownerProfile: { create: { companyName: 'Kebede Properties PLC', payoutMethod: 'TELEBIRR', telebirrNumber: seed.phoneNumber } } }
        : {}),
      ...(seed.role === UserRole.TENANT
        ? { tenantProfile: { create: { emergencyContactName: 'Tadesse Bekele', emergencyContactPhone: '+251911000099', emergencyContactRelation: 'Father' } } }
        : {}),
    },
  });
}

export async function seed(prisma: PrismaClient): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const [admin, telecom, owner] = await Promise.all(SEED_USERS.slice(0, 3).map((u) => upsertUser(prisma, passwordHash, u)));
  const manager = await upsertUser(prisma, passwordHash, SEED_USERS[3], owner.id);
  const tenant = await upsertUser(prisma, passwordHash, SEED_USERS[4]);

  let property = await prisma.property.findFirst({ where: { ownerId: owner.id, name: 'Bole Heights Apartments' } });
  if (!property) {
    property = await prisma.property.create({
      data: {
        ownerId: owner.id,
        name: 'Bole Heights Apartments',
        type: PropertyType.MIXED_USE,
        city: 'Addis Ababa',
        subCity: 'Bole',
        woreda: '03',
        address: 'Bole Road, near Edna Mall',
        latitude: 8.9966,
        longitude: 38.7876,
        amenities: ['Parking', 'Elevator', 'Generator', 'Water tank', 'Security'],
        description: 'Modern apartments with ground-floor shops.',
      },
    });
  }
  const units = [
    { unitNumber: 'A-101', floor: 1, type: UnitType.APARTMENT, bedrooms: 2, bathrooms: 1, sizeSqm: 85, rentAmount: 18000, depositAmount: 36000 },
    { unitNumber: 'A-102', floor: 1, type: UnitType.APARTMENT, bedrooms: 3, bathrooms: 2, sizeSqm: 120, rentAmount: 26000, depositAmount: 52000 },
    { unitNumber: 'A-201', floor: 2, type: UnitType.STUDIO, bedrooms: 1, bathrooms: 1, sizeSqm: 45, rentAmount: 11000, depositAmount: 22000 },
    { unitNumber: 'S-01', floor: 0, type: UnitType.SHOP, sizeSqm: 40, rentAmount: 30000, depositAmount: 90000 },
  ];
  for (const unit of units) {
    await prisma.unit.upsert({
      where: { propertyId_unitNumber: { propertyId: property.id, unitNumber: unit.unitNumber } },
      update: {},
      create: { ...unit, propertyId: property.id, amenities: [], photos: [] },
    });
  }
  const vendor = await prisma.vendor.findFirst({ where: { ownerId: owner.id, name: 'Kality Plumbing Services' } });
  if (!vendor) {
    await prisma.vendor.create({
      data: { ownerId: owner.id, name: 'Kality Plumbing Services', serviceType: VendorServiceType.PLUMBING, phoneNumber: '+251911556677' },
    });
  }

  const agreementCount = await seedActiveAgreement(prisma, { owner, tenant, property });

  console.log('Seed complete:', {
    admin: admin.phoneNumber,
    telecom: telecom.phoneNumber,
    owner: owner.phoneNumber,
    manager: manager.phoneNumber,
    tenant: tenant.phoneNumber,
    password: SEED_PASSWORD,
    property: property.name,
    units: units.length,
    invoices: agreementCount,
  });
}

/**
 * One fully executed lease (unit A-101) with the rent/deposit invoices a signed agreement
 * normally produces. This is real data written through the same builders the signing flow
 * uses, so payment history, prepayment and reminders can be exercised end to end.
 */
async function seedActiveAgreement(
  prisma: PrismaClient,
  ctx: {
    owner: { id: string; fullName: string; phoneNumber: string };
    tenant: { id: string; fullName: string; phoneNumber: string };
    property: { id: string; name: string; address: string; city: string; subCity: string | null };
  },
): Promise<number> {
  const unit = await prisma.unit.findFirst({
    where: { propertyId: ctx.property.id, unitNumber: 'A-101' },
  });
  if (!unit) return 0;

  // Start on the 1st so rent periods align with calendar months.
  const now = new Date();
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const endDate = computeEndDate(startDate, 12);
  const signedAt = new Date(startDate.getTime() - 3 * 86_400_000);

  let agreement = await prisma.agreement.findFirst({ where: { unitId: unit.id, tenantId: ctx.tenant.id } });
  if (!agreement) {
    // The reference number is part of the hashed text, so generate it before building.
    const referenceNo = generateReference('AGR');
    const content = buildAgreementContent({
      referenceNo,
      owner: { fullName: ctx.owner.fullName, phoneNumber: ctx.owner.phoneNumber },
      tenant: { fullName: ctx.tenant.fullName, phoneNumber: ctx.tenant.phoneNumber },
      property: {
        name: ctx.property.name,
        address: ctx.property.address,
        city: ctx.property.city,
        subCity: ctx.property.subCity,
      },
      unit: { unitNumber: unit.unitNumber, type: unit.type },
      startDate,
      endDate,
      rentAmount: unit.rentAmount,
      depositAmount: unit.depositAmount,
      currency: 'ETB',
      paymentDueDay: 1,
    });

    agreement = await prisma.agreement.create({
      data: {
        referenceNo,
        unitId: unit.id,
        propertyId: ctx.property.id,
        tenantId: ctx.tenant.id,
        ownerId: ctx.owner.id,
        startDate,
        endDate,
        rentAmount: unit.rentAmount,
        depositAmount: unit.depositAmount,
        currency: 'ETB',
        paymentDueDay: 1,
        content,
        contentHash: hashContent(content),
        status: AgreementStatus.ACTIVE,
        ownerSignedAt: signedAt,
        ownerSignature: ctx.owner.fullName,
        tenantSignedAt: signedAt,
        tenantSignature: ctx.tenant.fullName,
        tenantSignatureIp: '127.0.0.1',
      },
    });
  }

  await prisma.unit.update({ where: { id: unit.id }, data: { status: UnitStatus.OCCUPIED } });

  const billing = {
    id: agreement.id,
    tenantId: agreement.tenantId,
    ownerId: agreement.ownerId,
    propertyId: agreement.propertyId,
    unitId: agreement.unitId,
    startDate: agreement.startDate,
    endDate: agreement.endDate,
    rentAmount: agreement.rentAmount,
    depositAmount: agreement.depositAmount,
    paymentDueDay: agreement.paymentDueDay,
    currency: agreement.currency,
  };

  const existing = await prisma.invoice.findMany({
    where: { agreementId: agreement.id },
    select: { type: true, periodStart: true },
  });
  const seen = new Set(existing.map(invoiceKey));
  const drafts = [
    buildDepositInvoiceDraft(billing),
    ...buildRentInvoiceDrafts(billing, new Date(startDate.getTime() + 90 * 86_400_000)),
  ].filter(Boolean) as InvoiceDraft[];

  const missing = drafts.filter((draft) => !seen.has(invoiceKey(draft)));
  if (missing.length) {
    await prisma.invoice.createMany({
      data: missing.map((draft) => ({ ...draft, invoiceNo: generateReference('INV') })),
      skipDuplicates: true,
    });
  }
  return missing.length;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
