import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockConfig, mockNotifications, mockRealtime, USERS, IDS } from '../../../test-utils/mocks';
import { AgreementsService } from './agreements.service';
import { hashContent } from './utils/agreement-content.util';

const owner = { id: IDS.owner, fullName: 'Abebe', phoneNumber: '+251911000003', approvalStatus: 'APPROVED', isSuspended: false };
const tenant = { id: IDS.tenant, fullName: 'Meron', phoneNumber: '+251911000005', role: 'TENANT', isSuspended: false };
const unit = {
  id: IDS.unit, unitNumber: 'A-101', type: 'APARTMENT', status: 'VACANT', rentAmount: 18000, depositAmount: 36000, currency: 'ETB', terms: null,
  property: { id: IDS.property, ownerId: IDS.owner, name: 'Bole', address: 'Rd', city: 'Addis Ababa', subCity: 'Bole' },
};

describe('AgreementsService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const notifications = mockNotifications();
  const realtime = mockRealtime();
  const invoices = { generateInitialInvoices: jest.fn(), cancelFutureInvoices: jest.fn() };
  const service = new AgreementsService(prisma, audit as any, notifications as any, realtime as any, invoices as any, mockConfig({ LEASE_EXPIRY_REMINDER_DAYS: 30 }));

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.agreement.create.mockImplementation(async ({ data }) => ({ id: IDS.agreement, ...data }));
  });

  it('createAgreementRecord generates content, hash, end date and owner signature', async () => {
    const record: any = await service.createAgreementRecord(prisma, {
      unit: unit as any, owner, tenant, startDate: new Date('2026-10-01T09:00:00Z'), durationMonths: 12,
      rentAmount: 18000, depositAmount: 36000, paymentDueDay: 5,
    });
    expect(record.referenceNo).toMatch(/^AGR-/);
    expect(record.contentHash).toBe(hashContent(record.content));
    expect(record.startDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(record.endDate.toISOString()).toBe('2027-09-30T00:00:00.000Z');
    expect(record).toMatchObject({ ownerSignature: 'Abebe', tenantId: IDS.tenant, ownerId: IDS.owner, propertyId: IDS.property });
  });

  it('createFromRequest uses request defaults overridden by owner terms', async () => {
    const request = { id: IDS.request, desiredStartDate: new Date('2026-10-01T00:00:00Z'), durationMonths: 6, unit, tenant };
    const record: any = await service.createFromRequest(prisma, request as any, owner as any, { rentAmount: 17000, paymentDueDay: 3 });
    expect(record).toMatchObject({ rentAmount: 17000, depositAmount: 36000, paymentDueDay: 3, rentalRequestId: IDS.request });
    expect(record.endDate.toISOString()).toBe('2027-03-31T00:00:00.000Z');
  });

  it('assertOwnerApproved rejects pending or suspended owners', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(owner);
    await expect(service.assertOwnerApproved(IDS.owner)).resolves.toBe(owner);
    prisma.user.findUnique.mockResolvedValueOnce({ ...owner, approvalStatus: 'PENDING' });
    await expect(service.assertOwnerApproved(IDS.owner)).rejects.toThrow(ForbiddenException);
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.assertOwnerApproved(IDS.owner)).rejects.toThrow(NotFoundException);
  });

  describe('createDirect', () => {
    const dto = { unitId: IDS.unit, tenantId: IDS.tenant, startDate: '2026-10-01', durationMonths: 12 };

    it('creates a pending agreement and reserves the unit', async () => {
      prisma.user.findUnique.mockResolvedValue(owner);
      prisma.unit.findUnique.mockResolvedValue(unit);
      prisma.user.findFirst.mockResolvedValue(tenant);
      const agreement: any = await service.createDirect(USERS.owner, dto);
      expect(prisma.unit.update).toHaveBeenCalledWith({ where: { id: IDS.unit }, data: { status: 'RESERVED' } });
      expect(agreement.rentAmount).toBe(18000);
      expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'AGREEMENT_READY', expect.anything(), expect.anything());
    });

    it('rejects foreign units, occupied units and missing/suspended tenants', async () => {
      prisma.user.findUnique.mockResolvedValue(owner);
      prisma.unit.findUnique.mockResolvedValueOnce({ ...unit, property: { ...unit.property, ownerId: 'x' } });
      await expect(service.createDirect(USERS.owner, dto)).rejects.toThrow(NotFoundException);
      prisma.unit.findUnique.mockResolvedValueOnce({ ...unit, status: 'OCCUPIED' });
      await expect(service.createDirect(USERS.owner, dto)).rejects.toThrow(BadRequestException);
      prisma.unit.findUnique.mockResolvedValue(unit);
      prisma.user.findFirst.mockResolvedValueOnce(null);
      await expect(service.createDirect(USERS.owner, dto)).rejects.toThrow('Tenant not found');
      prisma.user.findFirst.mockResolvedValueOnce({ ...tenant, isSuspended: true });
      await expect(service.createDirect(USERS.owner, dto)).rejects.toThrow('suspended');
    });
  });

  it('afterCreated audits, notifies and syncs', async () => {
    await service.afterCreated(USERS.owner, { id: 'a', referenceNo: 'R', tenantId: 't', ownerId: 'o' });
    expect(audit.log).toHaveBeenCalledWith('AGREEMENT_CREATED', 'Agreement', 'a', USERS.owner, { referenceNo: 'R' });
    expect(realtime.emitToStaff).toHaveBeenCalled();
  });

  it('findAll scopes by role and hides content', async () => {
    prisma.agreement.findMany.mockResolvedValue([]);
    prisma.agreement.count.mockResolvedValue(0);
    await service.findAll(USERS.tenant, { status: 'ACTIVE' });
    expect(prisma.agreement.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: IDS.tenant, status: 'ACTIVE' }, omit: { content: true } });
    await service.findAll(USERS.admin, { ownerId: 'o' });
    expect(prisma.agreement.findMany.mock.calls[1][0].where).toEqual({ ownerId: 'o' });
  });

  it('findOne returns the agreement with integrity for parties only', async () => {
    const content = 'text';
    prisma.agreement.findUnique.mockResolvedValue({ id: 'a', ownerId: IDS.owner, tenantId: IDS.tenant, content, contentHash: hashContent(content) });
    await expect(service.findOne(USERS.tenant, 'a')).resolves.toMatchObject({ integrity: { contentValid: true, signatureValid: null } });
    await expect(service.findOne(USERS.otherOwner, 'a')).rejects.toThrow(ForbiddenException);
    prisma.agreement.findUnique.mockResolvedValue(null);
    await expect(service.findOne(USERS.admin, 'a')).rejects.toThrow(NotFoundException);
  });

  describe('sign', () => {
    const pending = {
      id: IDS.agreement, tenantId: IDS.tenant, ownerId: IDS.owner, unitId: IDS.unit, status: 'PENDING_SIGNATURE',
      contentHash: 'h'.repeat(64), renewedFromId: null, unit: { status: 'RESERVED' }, renewedFrom: null,
    };
    const dto = { signatureName: 'Meron', contentHash: 'h'.repeat(64), acceptTerms: true };

    it('activates the agreement, occupies the unit, generates invoices, notifies owner', async () => {
      prisma.agreement.findUnique
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce({ ...pending, status: 'ACTIVE', referenceNo: 'R', unit: { unitNumber: 'A' }, tenant: { fullName: 'Meron' } });
      prisma.agreement.updateMany.mockResolvedValue({ count: 1 });
      const signed: any = await service.sign(USERS.tenant, IDS.agreement, dto);
      expect(signed.status).toBe('ACTIVE');
      const data = prisma.agreement.updateMany.mock.calls[0][0].data;
      expect(data).toMatchObject({ status: 'ACTIVE', tenantSignature: 'Meron', tenantSignatureIp: '127.0.0.1' });
      expect(data.signatureHash).toHaveLength(64);
      expect(prisma.unit.update).toHaveBeenCalledWith({ where: { id: IDS.unit }, data: { status: 'OCCUPIED' } });
      expect(invoices.generateInitialInvoices).toHaveBeenCalled();
      expect(notifications.notifyOwner).toHaveBeenCalledWith(IDS.owner, 'AGREEMENT_SIGNED', expect.anything(), expect.anything());
    });

    it('marks the previous agreement RENEWED when signing a renewal', async () => {
      const renewal = { ...pending, renewedFromId: 'old', renewedFrom: { status: 'ACTIVE' }, unit: { status: 'OCCUPIED' } };
      prisma.agreement.findUnique.mockResolvedValueOnce(renewal).mockResolvedValueOnce({ ...renewal, referenceNo: 'R', unit: { unitNumber: 'A' }, tenant: { fullName: 'M' } });
      prisma.agreement.updateMany.mockResolvedValue({ count: 1 });
      await service.sign(USERS.tenant, IDS.agreement, dto);
      expect(prisma.agreement.update).toHaveBeenCalledWith({ where: { id: 'old' }, data: { status: 'RENEWED' } });
      expect(audit.log).toHaveBeenCalledWith('AGREEMENT_RENEWED', 'Agreement', 'old', USERS.tenant, { renewedTo: IDS.agreement });
    });

    it('rejects wrong tenant, wrong status, changed text, lost reservation and double signing', async () => {
      prisma.agreement.findUnique.mockResolvedValueOnce({ ...pending, tenantId: 'other' });
      await expect(service.sign(USERS.tenant, 'a', dto)).rejects.toThrow(NotFoundException);
      prisma.agreement.findUnique.mockResolvedValueOnce({ ...pending, status: 'ACTIVE' });
      await expect(service.sign(USERS.tenant, 'a', dto)).rejects.toThrow('Agreement is ACTIVE');
      prisma.agreement.findUnique.mockResolvedValueOnce(pending);
      await expect(service.sign(USERS.tenant, 'a', { ...dto, contentHash: 'x'.repeat(64) })).rejects.toThrow('changed');
      prisma.agreement.findUnique.mockResolvedValueOnce({ ...pending, unit: { status: 'VACANT' } });
      await expect(service.sign(USERS.tenant, 'a', dto)).rejects.toThrow('no longer reserved');
      prisma.agreement.findUnique.mockResolvedValueOnce({ ...pending, renewedFromId: 'old', renewedFrom: { status: 'EXPIRED' } });
      await expect(service.sign(USERS.tenant, 'a', dto)).rejects.toThrow('no longer active');
      prisma.agreement.findUnique.mockResolvedValueOnce(pending);
      prisma.agreement.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.sign(USERS.tenant, 'a', dto)).rejects.toThrow('already signed');
    });
  });

  describe('renew', () => {
    const current = {
      id: 'old', ownerId: IDS.owner, status: 'ACTIVE', endDate: new Date('2027-09-30T00:00:00Z'), rentAmount: 18000,
      paymentDueDay: 5, specialTerms: null, unit, tenant, renewedTo: null,
    };

    it('creates a renewal starting the day after the current end date', async () => {
      prisma.user.findUnique.mockResolvedValue(owner);
      prisma.agreement.findFirst.mockResolvedValue(current);
      const renewal: any = await service.renew(USERS.owner, 'old', { durationMonths: 12, rentAmount: 19000 });
      expect(renewal).toMatchObject({ renewedFromId: 'old', rentAmount: 19000, depositAmount: 0 });
      expect(renewal.startDate.toISOString()).toBe('2027-10-01T00:00:00.000Z');
    });

    it('releases a cancelled previous renewal and blocks duplicates / inactive agreements', async () => {
      prisma.user.findUnique.mockResolvedValue(owner);
      prisma.agreement.findFirst.mockResolvedValueOnce({ ...current, renewedTo: { id: 'r0', status: 'CANCELLED' } });
      await service.renew(USERS.owner, 'old', { durationMonths: 6 });
      expect(prisma.agreement.update).toHaveBeenCalledWith({ where: { id: 'r0' }, data: { renewedFromId: null } });
      prisma.agreement.findFirst.mockResolvedValueOnce({ ...current, renewedTo: { id: 'r1', status: 'PENDING_SIGNATURE' } });
      await expect(service.renew(USERS.owner, 'old', { durationMonths: 6 })).rejects.toThrow('already exists');
      prisma.agreement.findFirst.mockResolvedValueOnce({ ...current, status: 'EXPIRED' });
      await expect(service.renew(USERS.owner, 'old', { durationMonths: 6 })).rejects.toThrow(BadRequestException);
      prisma.agreement.findFirst.mockResolvedValueOnce(null);
      await expect(service.renew(USERS.owner, 'old', { durationMonths: 6 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('terminate', () => {
    const active = { id: 'a', referenceNo: 'R', ownerId: IDS.owner, tenantId: IDS.tenant, unitId: IDS.unit, status: 'ACTIVE', renewedTo: { id: 'r', status: 'PENDING_SIGNATURE' } };

    it('terminates, cancels pending renewal + future invoices and vacates the unit', async () => {
      prisma.agreement.findUnique.mockResolvedValue(active);
      prisma.agreement.update.mockResolvedValue({ ...active, status: 'TERMINATED' });
      await service.terminate(USERS.owner, 'a', { reason: 'Moving', effectiveDate: '2026-12-31' });
      expect(prisma.agreement.update).toHaveBeenCalledWith({ where: { id: 'r' }, data: { status: 'CANCELLED' } });
      expect(prisma.unit.update).toHaveBeenCalledWith({ where: { id: IDS.unit }, data: { status: 'VACANT' } });
      expect(invoices.cancelFutureInvoices).toHaveBeenCalledWith(prisma, 'a', new Date('2026-12-31T00:00:00Z'));
      expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'AGREEMENT_TERMINATED', { reference: 'R' }, { sms: true });
    });

    it('allows admins, rejects other owners and non-active agreements', async () => {
      prisma.agreement.findUnique.mockResolvedValue(active);
      prisma.agreement.update.mockResolvedValue(active);
      await expect(service.terminate(USERS.admin, 'a', { reason: 'Fraud' })).resolves.toBeDefined();
      await expect(service.terminate(USERS.otherOwner, 'a', { reason: 'x' })).rejects.toThrow(NotFoundException);
      prisma.agreement.findUnique.mockResolvedValue({ ...active, status: 'EXPIRED' });
      await expect(service.terminate(USERS.owner, 'a', { reason: 'x' })).rejects.toThrow(BadRequestException);
      prisma.agreement.findUnique.mockResolvedValue(null);
      await expect(service.terminate(USERS.owner, 'a', { reason: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  it('cancel withdraws a pending agreement and frees a reserved unit', async () => {
    const pending = { id: 'a', ownerId: IDS.owner, tenantId: IDS.tenant, unitId: IDS.unit, status: 'PENDING_SIGNATURE', renewedFromId: null };
    prisma.agreement.findUnique.mockResolvedValue(pending);
    prisma.agreement.update.mockResolvedValue({ ...pending, status: 'CANCELLED' });
    await expect(service.cancel(USERS.tenant, 'a')).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(prisma.unit.updateMany).toHaveBeenCalledWith({ where: { id: IDS.unit, status: 'RESERVED' }, data: { status: 'VACANT' } });
    prisma.agreement.findUnique.mockResolvedValue({ ...pending, status: 'ACTIVE' });
    await expect(service.cancel(USERS.owner, 'a')).rejects.toThrow(BadRequestException);
    prisma.agreement.findUnique.mockResolvedValue(null);
    await expect(service.cancel(USERS.owner, 'a')).rejects.toThrow(NotFoundException);
  });

  it('addDocument appends a document URL', async () => {
    prisma.agreement.findUnique.mockResolvedValue({ id: 'a', ownerId: IDS.owner, tenantId: IDS.tenant });
    prisma.agreement.update.mockResolvedValue({ id: 'a' });
    await service.addDocument(USERS.owner, 'a', { url: '/uploads/agreements/x.pdf' });
    expect(prisma.agreement.update.mock.calls[0][0].data).toEqual({ documents: { push: '/uploads/agreements/x.pdf' } });
    prisma.agreement.findUnique.mockResolvedValue(null);
    await expect(service.addDocument(USERS.owner, 'a', { url: 'x' })).rejects.toThrow(NotFoundException);
  });

  it('verifyByReference reports integrity publicly', async () => {
    prisma.agreement.findUnique.mockResolvedValueOnce({ status: 'ACTIVE', content: 'c', contentHash: hashContent('c'), tenantId: 't', tenantSignedAt: null });
    await expect(service.verifyByReference('R')).resolves.toMatchObject({ referenceNo: 'R', contentValid: true });
    prisma.agreement.findUnique.mockResolvedValueOnce(null);
    await expect(service.verifyByReference('R')).rejects.toThrow(NotFoundException);
  });

  it('expireAgreements expires past-due leases, cancels pending renewals, vacates units', async () => {
    prisma.agreement.findMany.mockResolvedValue([{ id: 'a', unitId: 'u', tenantId: 't', ownerId: 'o', renewedTo: { id: 'r', status: 'PENDING_SIGNATURE' } }]);
    await expect(service.expireAgreements(new Date('2027-10-05T00:00:00Z'))).resolves.toBe(1);
    expect(prisma.agreement.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { status: 'EXPIRED' } });
    expect(prisma.agreement.update).toHaveBeenCalledWith({ where: { id: 'r' }, data: { status: 'CANCELLED' } });
    expect(prisma.unit.update).toHaveBeenCalledWith({ where: { id: 'u' }, data: { status: 'VACANT' } });
    expect(audit.log).toHaveBeenCalledWith('AGREEMENT_EXPIRED', 'Agreement', 'a', null);
  });

  it('sendExpiryReminders notifies both parties once', async () => {
    prisma.agreement.findMany.mockResolvedValue([{ id: 'a', referenceNo: 'R', tenantId: 't', ownerId: 'o', endDate: new Date('2026-10-20T00:00:00Z'), unit: { unitNumber: 'A' } }]);
    await expect(service.sendExpiryReminders(new Date('2026-09-29T00:00:00Z'))).resolves.toBe(1);
    expect(notifications.notify).toHaveBeenCalledWith(['t'], 'LEASE_EXPIRING', expect.objectContaining({ endDate: '2026-10-20' }), expect.anything());
    expect(notifications.notifyOwner).toHaveBeenCalledWith('o', 'LEASE_EXPIRING', expect.anything(), expect.anything());
    expect(prisma.agreement.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { expiryReminderSentAt: expect.any(Date) } });
  });
});
