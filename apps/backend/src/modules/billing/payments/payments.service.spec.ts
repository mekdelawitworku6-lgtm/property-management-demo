import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockConfig, mockNotifications, mockRealtime, USERS, IDS } from '../../../test-utils/mocks';
import { PaymentsService, resolveConfirmationSource } from './payments.service';

const invoice = { id: IDS.invoice, invoiceNo: 'INV-1', status: 'UNPAID', amount: 18000, amountPaid: 0, tenantId: IDS.tenant, ownerId: IDS.owner, agreementId: IDS.agreement, propertyId: IDS.property };
const pendingPayment = { id: IDS.payment, referenceNo: 'PAY-1', method: 'TELEBIRR', status: 'PENDING', amount: 18000, invoiceId: IDS.invoice, tenantId: IDS.tenant, ownerId: IDS.owner, providerReference: null, notes: null };

describe('PaymentsService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const notifications = mockNotifications();
  const realtime = mockRealtime();
  const telebirr = {
    createPaymentOrder: jest.fn().mockResolvedValue({ paymentUrl: 'http://pay', mode: 'mock' }),
    verifyCallback: jest.fn().mockReturnValue({ ok: true }),
    parseCallback: jest.fn(),
    queryOrder: jest.fn(),
    isMock: jest.fn().mockReturnValue(true),
  };
  const invoices = { applyPayment: jest.fn() };
  const service = new PaymentsService(prisma, audit as any, notifications as any, realtime as any, telebirr as any, invoices as any, mockConfig({ BASE_URL: 'http://api' }));

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.payment.findUnique.mockResolvedValue(null);
    prisma.payment.create.mockImplementation(async ({ data }) => ({ id: IDS.payment, ...data }));
  });

  it('resolveConfirmationSource maps roles to sources', () => {
    expect(resolveConfirmationSource(USERS.telecom, 'TELEBIRR')).toBe('ETHIO_TELECOM');
    expect(resolveConfirmationSource(USERS.admin, 'CASH')).toBe('ADMIN');
    expect(resolveConfirmationSource(USERS.owner, 'BANK_TRANSFER')).toBe('OWNER');
    expect(() => resolveConfirmationSource(USERS.owner, 'TELEBIRR')).toThrow(ForbiddenException);
    expect(() => resolveConfirmationSource(USERS.tenant, 'BANK_TRANSFER')).toThrow(ForbiddenException);
  });

  it('findByClientRef returns null without a key', async () => {
    await expect(service.findByClientRef()).resolves.toBeNull();
    prisma.payment.findUnique.mockResolvedValueOnce({ id: 'x' });
    await expect(service.findByClientRef('k')).resolves.toEqual({ id: 'x' });
  });

  describe('resolvePayable', () => {
    it('defaults to outstanding minus pending payments', async () => {
      prisma.invoice.findUnique.mockResolvedValue({ ...invoice, amountPaid: 3000 });
      prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 5000 } });
      await expect(service.resolvePayable(IDS.invoice)).resolves.toMatchObject({ amount: 10000 });
    });

    it('rejects paid/cancelled invoices, fully covered invoices and overpayment', async () => {
      prisma.invoice.findUnique.mockResolvedValueOnce({ ...invoice, status: 'PAID' });
      await expect(service.resolvePayable(IDS.invoice)).rejects.toThrow('Invoice is PAID');
      prisma.payment.aggregate.mockResolvedValueOnce({ _sum: { amount: 18000 } });
      await expect(service.resolvePayable(IDS.invoice)).rejects.toThrow('fully covered');
      await expect(service.resolvePayable(IDS.invoice, 20000)).rejects.toThrow('exceeds');
      prisma.invoice.findUnique.mockResolvedValueOnce(null);
      await expect(service.resolvePayable(IDS.invoice)).rejects.toThrow(NotFoundException);
    });
  });

  describe('initiateTelebirr', () => {
    it('creates a pending Telebirr payment with checkout URL', async () => {
      const result: any = await service.initiateTelebirr(USERS.tenant, { invoiceId: IDS.invoice, clientRef: 'c1' });
      expect(telebirr.createPaymentOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 18000, notifyUrl: 'http://api/api/v1/payments/telebirr/webhook' }));
      expect(result.payment).toMatchObject({ method: 'TELEBIRR', amount: 18000, checkoutUrl: 'http://pay', clientRef: 'c1' });
      expect(audit.log).toHaveBeenCalledWith('PAYMENT_INITIATED', 'Payment', IDS.payment, USERS.tenant, expect.objectContaining({ method: 'TELEBIRR' }));
    });

    it('is idempotent on clientRef and rejects other tenants invoices', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce({ id: 'existing', checkoutUrl: 'u' });
      await expect(service.initiateTelebirr(USERS.tenant, { invoiceId: IDS.invoice, clientRef: 'c1' })).resolves.toMatchObject({ payment: { id: 'existing' } });
      prisma.invoice.findUnique.mockResolvedValue({ ...invoice, tenantId: 'other' });
      await expect(service.initiateTelebirr(USERS.tenant, { invoiceId: IDS.invoice })).rejects.toThrow(NotFoundException);
    });
  });

  describe('submitBankTransfer', () => {
    const dto = { invoiceId: IDS.invoice, bankName: 'CBE', providerReference: 'FT1', amount: 18000 };

    it('creates a pending bank transfer and notifies owner + staff', async () => {
      prisma.payment.findFirst.mockResolvedValue(null);
      await expect(service.submitBankTransfer(USERS.tenant, dto)).resolves.toMatchObject({ method: 'BANK_TRANSFER', providerReference: 'FT1' });
      expect(realtime.emitToStaff).toHaveBeenCalled();
    });

    it('rejects duplicate bank references and foreign invoices', async () => {
      prisma.payment.findFirst.mockResolvedValue({ id: 'dup' });
      await expect(service.submitBankTransfer(USERS.tenant, dto)).rejects.toThrow(ConflictException);
      prisma.invoice.findUnique.mockResolvedValue({ ...invoice, tenantId: 'other' });
      await expect(service.submitBankTransfer(USERS.tenant, dto)).rejects.toThrow(NotFoundException);
      prisma.payment.findUnique.mockResolvedValueOnce({ id: 'existing' });
      await expect(service.submitBankTransfer(USERS.tenant, { ...dto, clientRef: 'k' })).resolves.toEqual({ id: 'existing' });
    });
  });

  describe('recordOffline', () => {
    it('records a confirmed cash payment and applies it to the invoice', async () => {
      const payment: any = await service.recordOffline(USERS.manager, { invoiceId: IDS.invoice, method: 'CASH', amount: 5000 });
      expect(payment).toMatchObject({ status: 'CONFIRMED', confirmationSource: 'OWNER', method: 'CASH', amount: 5000, confirmedById: USERS.manager.id });
      expect(invoices.applyPayment).toHaveBeenCalledWith(prisma, IDS.invoice, 5000);
      expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'PAYMENT_RECEIVED', expect.anything(), expect.objectContaining({ sms: true }));
    });

    it('rejects invoices of other owners and tenants as callers', async () => {
      await expect(service.recordOffline(USERS.otherOwner, { invoiceId: IDS.invoice, method: 'CASH' })).rejects.toThrow(NotFoundException);
      await expect(service.recordOffline(USERS.tenant, { invoiceId: IDS.invoice, method: 'CASH' })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('confirmInternal', () => {
    it('confirms pending payments once and applies them', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(pendingPayment);
      prisma.payment.update.mockResolvedValue({ ...pendingPayment, status: 'CONFIRMED' });
      await service.confirmInternal(IDS.payment, 'TELEBIRR_WEBHOOK', null, { providerReference: 'T1' });
      expect(prisma.payment.update.mock.calls[0][0].data).toMatchObject({ status: 'CONFIRMED', confirmationSource: 'TELEBIRR_WEBHOOK', providerReference: 'T1' });
      expect(invoices.applyPayment).toHaveBeenCalledWith(prisma, IDS.invoice, 18000);
      expect(audit.log).toHaveBeenCalledWith('PAYMENT_CONFIRMED', 'Payment', IDS.payment, null, expect.anything());
    });

    it('is idempotent for already confirmed payments', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce({ ...pendingPayment, status: 'CONFIRMED' }).mockResolvedValueOnce({ id: 'same' });
      await expect(service.confirmInternal(IDS.payment, 'ADMIN', USERS.admin)).resolves.toEqual({ id: 'same' });
      expect(invoices.applyPayment).not.toHaveBeenCalled();
    });

    it('rejects missing and non-pending payments', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(null);
      await expect(service.confirmInternal('x', 'ADMIN', USERS.admin)).rejects.toThrow(NotFoundException);
      prisma.payment.findUnique.mockResolvedValueOnce({ ...pendingPayment, status: 'REJECTED' });
      await expect(service.confirmInternal('x', 'ADMIN', USERS.admin)).rejects.toThrow(BadRequestException);
    });
  });

  it('afterConfirmed notifies tenant, owner and staff', async () => {
    await service.afterConfirmed(pendingPayment as any);
    expect(notifications.notifyOwner).toHaveBeenCalledWith(IDS.owner, 'PAYMENT_RECEIVED', { amount: 18000, reference: 'PAY-1' }, expect.anything());
    expect(realtime.emitToStaff).toHaveBeenCalledWith('payment.updated', pendingPayment);
  });

  describe('confirm / reject', () => {
    it('Ethio Telecom confirms Telebirr payments', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(pendingPayment);
      const spy = jest.spyOn(service, 'confirmInternal').mockResolvedValueOnce({ id: 'ok' } as any);
      await service.confirm(USERS.telecom, IDS.payment, { providerReference: 'T' });
      expect(spy).toHaveBeenCalledWith(IDS.payment, 'ETHIO_TELECOM', USERS.telecom, { providerReference: 'T' });
    });

    it('owners confirm only their own bank transfers', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce({ ...pendingPayment, method: 'BANK_TRANSFER', ownerId: 'other' });
      await expect(service.confirm(USERS.owner, IDS.payment, {})).rejects.toThrow(NotFoundException);
      prisma.payment.findUnique.mockResolvedValueOnce(null);
      await expect(service.confirm(USERS.owner, IDS.payment, {})).rejects.toThrow(NotFoundException);
    });

    it('reject marks pending payments rejected and notifies the tenant', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce({ ...pendingPayment, method: 'BANK_TRANSFER' });
      prisma.payment.update.mockResolvedValue({ status: 'REJECTED' });
      await service.reject(USERS.owner, IDS.payment, { reason: 'Not received' });
      expect(prisma.payment.update.mock.calls[0][0].data).toMatchObject({ status: 'REJECTED', failureReason: 'Not received' });
      expect(notifications.notify).toHaveBeenCalledWith([IDS.tenant], 'PAYMENT_REJECTED', expect.anything(), expect.anything());
      prisma.payment.findUnique.mockResolvedValueOnce({ ...pendingPayment, status: 'CONFIRMED' });
      await expect(service.reject(USERS.telecom, IDS.payment, { reason: 'x' })).rejects.toThrow(BadRequestException);
      prisma.payment.findUnique.mockResolvedValueOnce(null);
      await expect(service.reject(USERS.telecom, IDS.payment, { reason: 'x' })).rejects.toThrow(NotFoundException);
      prisma.payment.findUnique.mockResolvedValueOnce({ ...pendingPayment, method: 'BANK_TRANSFER', ownerId: 'x' });
      await expect(service.reject(USERS.owner, IDS.payment, { reason: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('handleTelebirrWebhook', () => {
    const callback = (extra = {}) => ({ callback: { orderReference: 'PAY-1', success: true, amount: 18000, transId: 'T1', resultCode: '0', ...extra } });

    it('rejects unverifiable bodies and unknown references', async () => {
      telebirr.verifyCallback.mockReturnValueOnce({ ok: false, reason: 'bad sig' });
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
      await expect(service.handleTelebirrWebhook('x')).resolves.toEqual({ ok: false, reason: 'bad sig' });
      telebirr.parseCallback.mockReturnValueOnce(callback());
      await expect(service.handleTelebirrWebhook('x')).resolves.toMatchObject({ ok: false, reason: 'Unknown payment reference' });
    });

    it('confirms successful callbacks with matching amount', async () => {
      telebirr.parseCallback.mockReturnValue(callback());
      prisma.payment.findUnique.mockResolvedValueOnce(pendingPayment);
      const spy = jest.spyOn(service, 'confirmInternal').mockResolvedValueOnce({} as any);
      await expect(service.handleTelebirrWebhook('x')).resolves.toEqual({ ok: true });
      expect(spy).toHaveBeenCalledWith(IDS.payment, 'TELEBIRR_WEBHOOK', null, { providerReference: 'T1' });
    });

    it('ignores already processed payments (idempotent)', async () => {
      telebirr.parseCallback.mockReturnValue(callback());
      prisma.payment.findUnique.mockResolvedValueOnce({ ...pendingPayment, status: 'CONFIRMED' });
      await expect(service.handleTelebirrWebhook('x')).resolves.toEqual({ ok: true });
    });

    it('marks failed payments and rejects amount mismatches', async () => {
      telebirr.parseCallback.mockReturnValue(callback({ success: false, resultCode: '2', resultMsg: 'Insufficient balance' }));
      prisma.payment.findUnique.mockResolvedValueOnce(pendingPayment);
      await service.handleTelebirrWebhook('x');
      expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: IDS.payment }, data: { status: 'FAILED', failureReason: 'Insufficient balance' } });
      telebirr.parseCallback.mockReturnValue(callback({ amount: 1 }));
      prisma.payment.findUnique.mockResolvedValueOnce(pendingPayment);
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
      await expect(service.handleTelebirrWebhook('x')).resolves.toEqual({ ok: false, reason: 'Amount mismatch' });
    });
  });

  describe('reconcileTelebirr', () => {
    it('confirms completed, fails failed and keeps pending payments', async () => {
      const spy = jest.spyOn(service, 'confirmInternal').mockResolvedValue({ id: 'c' } as any);
      prisma.payment.findUnique.mockResolvedValue(pendingPayment);
      telebirr.queryOrder.mockResolvedValueOnce({ status: 'completed', transId: 'T' });
      await service.reconcileTelebirr(USERS.telecom, IDS.payment);
      expect(spy).toHaveBeenCalledWith(IDS.payment, 'ETHIO_TELECOM', USERS.telecom, { providerReference: 'T' });
      telebirr.queryOrder.mockResolvedValueOnce({ status: 'failed' });
      await service.reconcileTelebirr(USERS.telecom, IDS.payment);
      expect(prisma.payment.update.mock.calls.at(-1)[0].data.status).toBe('FAILED');
      telebirr.queryOrder.mockResolvedValueOnce({ status: 'pending' });
      await expect(service.reconcileTelebirr(USERS.telecom, IDS.payment)).resolves.toBe(pendingPayment);
    });

    it('rejects non-Telebirr payments and returns settled ones unchanged', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce({ ...pendingPayment, method: 'CASH' });
      await expect(service.reconcileTelebirr(USERS.telecom, 'x')).rejects.toThrow(NotFoundException);
      prisma.payment.findUnique.mockResolvedValueOnce({ ...pendingPayment, status: 'CONFIRMED' });
      await expect(service.reconcileTelebirr(USERS.telecom, 'x')).resolves.toMatchObject({ status: 'CONFIRMED' });
    });
  });

  it('completeMockCheckout simulates a webhook only in mock mode', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce(pendingPayment);
    const spy = jest.spyOn(service, 'handleTelebirrWebhook').mockResolvedValueOnce({ ok: true });
    await service.completeMockCheckout('PAY-1');
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({ merch_order_id: 'PAY-1', amount: 18000 });
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    await expect(service.completeMockCheckout('x')).rejects.toThrow(NotFoundException);
    telebirr.isMock.mockReturnValueOnce(false);
    await expect(service.completeMockCheckout('x')).rejects.toThrow(ForbiddenException);
  });

  it('buildWhere scopes and filters', () => {
    expect(service.buildWhere(USERS.admin, { ownerId: 'o', status: 'PENDING', method: 'CASH', from: '2026-09-01', to: '2026-09-30' })).toMatchObject({
      ownerId: 'o', status: 'PENDING', method: 'CASH', createdAt: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30T23:59:59.999Z') },
    });
    expect(service.buildWhere(USERS.tenant, { ownerId: 'o' })).toEqual({ tenantId: IDS.tenant });
  });

  it('findAll returns history with the confirmed total', async () => {
    prisma.payment.findMany.mockResolvedValue([{ id: 'p' }]);
    prisma.payment.count.mockResolvedValue(1);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 18000 } });
    await expect(service.findAll(USERS.tenant, {})).resolves.toMatchObject({ docs: [{ id: 'p' }], totalConfirmed: 18000 });
  });

  it('findOne enforces access', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce(pendingPayment);
    await expect(service.findOne(USERS.tenant, IDS.payment)).resolves.toBe(pendingPayment);
    prisma.payment.findUnique.mockResolvedValueOnce(pendingPayment);
    await expect(service.findOne(USERS.otherOwner, IDS.payment)).rejects.toThrow(ForbiddenException);
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    await expect(service.findOne(USERS.tenant, IDS.payment)).rejects.toThrow(NotFoundException);
  });
});
