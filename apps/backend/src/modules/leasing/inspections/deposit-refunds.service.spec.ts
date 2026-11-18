import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createPrismaMock, mockAudit, mockNotifications, mockRealtime, IDS, USERS } from '../../../test-utils/mocks';
import { DepositRefundsService } from './deposit-refunds.service';

const agreement = {
  id: IDS.agreement,
  propertyId: IDS.property,
  unitId: IDS.unit,
  tenantId: IDS.tenant,
  depositAmount: 36000,
  property: { id: IDS.property, name: 'Building A' },
  unit: { id: IDS.unit, unitNumber: 'A-101' },
};

const refund = (overrides: Record<string, unknown> = {}) => ({
  id: IDS.depositRefund,
  referenceNo: 'DRF-20261118-ABC123',
  agreementId: IDS.agreement,
  propertyId: IDS.property,
  unitId: IDS.unit,
  ownerId: IDS.owner,
  tenantId: IDS.tenant,
  inspectionId: null,
  depositAmount: 36000,
  deductions: 0,
  refundAmount: 36000,
  status: 'PENDING',
  notes: null,
  providerReference: null,
  createdById: IDS.owner,
  approvedById: null,
  paidAt: null,
  agreement: {
    id: IDS.agreement,
    referenceNo: 'AGR-1',
    status: 'ACTIVE',
    property: { id: IDS.property, name: 'Building A' },
    unit: { id: IDS.unit, unitNumber: 'A-101' },
  },
  tenant: { id: IDS.tenant, fullName: 'Tenant user', phoneNumber: '+251911000005' },
  inspection: null,
  createdBy: { id: IDS.owner, fullName: 'Owner user' },
  approvedBy: null,
  ...overrides,
});

describe('DepositRefundsService', () => {
  const prisma = createPrismaMock();
  const audit = mockAudit();
  const notifications = mockNotifications();
  const realtime = mockRealtime();
  const service = new DepositRefundsService(prisma, audit as any, notifications as any, realtime as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('create computes the refund from the agreement deposit', async () => {
    prisma.agreement.findFirst.mockResolvedValueOnce(agreement);
    prisma.depositRefund.findUnique.mockResolvedValueOnce(null);
    prisma.depositRefund.create.mockResolvedValueOnce(refund());

    await expect(service.create(USERS.owner, { agreementId: IDS.agreement })).resolves.toMatchObject({
      id: IDS.depositRefund,
      refundAmount: 36000,
    });
    expect(prisma.depositRefund.create.mock.calls[0][0].data).toMatchObject({
      ownerId: IDS.owner,
      tenantId: IDS.tenant,
      depositAmount: 36000,
      deductions: 0,
      refundAmount: 36000,
      status: 'PENDING',
      createdById: IDS.owner,
    });
    expect(audit.log).toHaveBeenCalledWith('DEPOSIT_REFUND_CREATED', 'DepositRefund', IDS.depositRefund, USERS.owner, expect.any(Object));
  });

  it('create requires a completed move-out inspection when deducting', async () => {
    prisma.agreement.findFirst.mockResolvedValueOnce(agreement);
    prisma.depositRefund.findUnique.mockResolvedValueOnce(null);
    await expect(service.create(USERS.owner, {
      agreementId: IDS.agreement,
      deductions: 2500,
    })).rejects.toThrow(BadRequestException);
    expect(prisma.depositRefund.create).not.toHaveBeenCalled();
  });

  it('create accepts deductions backed by a completed move-out inspection', async () => {
    prisma.agreement.findFirst.mockResolvedValueOnce(agreement);
    prisma.depositRefund.findUnique.mockResolvedValueOnce(null);
    prisma.inspection.findFirst.mockResolvedValueOnce({ id: IDS.inspection });
    prisma.depositRefund.create.mockResolvedValueOnce(refund({ deductions: 2500, refundAmount: 33500 }));

    await service.create(USERS.owner, {
      agreementId: IDS.agreement,
      inspectionId: IDS.inspection,
      deductions: 2500,
      notes: 'Repaint charges',
    });
    expect(prisma.inspection.findFirst.mock.calls[0][0].where).toMatchObject({
      id: IDS.inspection,
      agreementId: IDS.agreement,
      type: 'MOVE_OUT',
      status: 'COMPLETED',
    });
    expect(prisma.depositRefund.create.mock.calls[0][0].data).toMatchObject({
      deductions: 2500,
      refundAmount: 33500,
      inspectionId: IDS.inspection,
    });
  });

  it('create rejects agreements with no deposit and duplicate refunds', async () => {
    prisma.agreement.findFirst.mockResolvedValueOnce({ ...agreement, depositAmount: 0 });
    await expect(service.create(USERS.owner, { agreementId: IDS.agreement })).rejects.toThrow(BadRequestException);

    prisma.agreement.findFirst.mockResolvedValueOnce(agreement);
    prisma.depositRefund.findUnique.mockResolvedValueOnce(refund());
    await expect(service.create(USERS.owner, { agreementId: IDS.agreement })).rejects.toThrow(BadRequestException);
  });

  it('create returns an existing row for a replayed clientRef', async () => {
    const existing = refund();
    prisma.depositRefund.findUnique.mockResolvedValueOnce(existing);
    await expect(service.create(USERS.owner, {
      agreementId: IDS.agreement,
      clientRef: 'client-1',
    })).resolves.toBe(existing);
    expect(prisma.agreement.findFirst).not.toHaveBeenCalled();
  });

  it('create rejects agreements outside the owner portfolio', async () => {
    prisma.agreement.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(USERS.owner, { agreementId: IDS.agreement })).rejects.toThrow(NotFoundException);
  });

  it('approve only works for pending refunds', async () => {
    prisma.depositRefund.findFirst.mockResolvedValueOnce(refund());
    prisma.depositRefund.update.mockResolvedValueOnce(refund({ status: 'APPROVED', approvedById: IDS.owner }));
    await expect(service.approve(USERS.owner, IDS.depositRefund, { notes: 'Approved' })).resolves.toMatchObject({
      status: 'APPROVED',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      [IDS.tenant],
      'DEPOSIT_REFUND_APPROVED',
      expect.objectContaining({ amount: '36000.00' }),
      expect.any(Object),
    );

    prisma.depositRefund.findFirst.mockResolvedValueOnce(refund({ status: 'PAID' }));
    await expect(service.approve(USERS.owner, IDS.depositRefund, {})).rejects.toThrow(BadRequestException);
  });

  it('pay requires approval and records the provider reference', async () => {
    prisma.depositRefund.findFirst.mockResolvedValueOnce(refund());
    await expect(service.pay(USERS.owner, IDS.depositRefund, {})).rejects.toThrow(BadRequestException);

    prisma.depositRefund.findFirst.mockResolvedValueOnce(refund({ status: 'APPROVED' }));
    prisma.depositRefund.update.mockResolvedValueOnce(refund({
      status: 'PAID',
      paidAt: new Date(),
      providerReference: 'TELEBIRR-1',
    }));
    await service.pay(USERS.owner, IDS.depositRefund, { providerReference: 'TELEBIRR-1' });
    expect(prisma.depositRefund.update.mock.calls[0][0].data).toMatchObject({
      status: 'PAID',
      providerReference: 'TELEBIRR-1',
      paidAt: expect.any(Date),
    });
    expect(audit.log).toHaveBeenCalledWith('DEPOSIT_REFUND_PAID', 'DepositRefund', IDS.depositRefund, USERS.owner, expect.any(Object));
  });

  it('reject moves a pending refund to rejected with a reason', async () => {
    prisma.depositRefund.findFirst.mockResolvedValueOnce(refund());
    prisma.depositRefund.update.mockResolvedValueOnce(refund({ status: 'REJECTED', notes: 'Damage dispute' }));
    await expect(service.reject(USERS.owner, IDS.depositRefund, { notes: 'Damage dispute' })).resolves.toMatchObject({
      status: 'REJECTED',
    });
    expect(notifications.notify).toHaveBeenCalledWith(
      [IDS.tenant],
      'DEPOSIT_REFUND_REJECTED',
      expect.objectContaining({ reason: 'Damage dispute' }),
      expect.any(Object),
    );
  });
});
