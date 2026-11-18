import { StreamableFile } from '@nestjs/common';
import { USERS } from '../../test-utils/mocks';
import { DashboardController } from './dashboard/dashboard.controller';
import { ReportsController, toStreamable } from './reports/reports.controller';

const file = { buffer: Buffer.from('x'), contentType: 'application/pdf', fileName: 'r.pdf' };
const res = () => ({ set: jest.fn() }) as any;

describe('Reporting controllers', () => {
  it('DashboardController delegates', async () => {
    const s = { ownerDashboard: jest.fn().mockResolvedValue('o'), tenantDashboard: jest.fn().mockResolvedValue('t'), adminDashboard: jest.fn().mockResolvedValue('a') };
    const c = new DashboardController(s as any);
    await expect(c.owner(USERS.owner, '2026-09')).resolves.toBe('o');
    await expect(c.tenant(USERS.tenant)).resolves.toBe('t');
    await expect(c.admin('2026-09')).resolves.toBe('a');
  });

  it('toStreamable sets download headers', () => {
    const r = res();
    expect(toStreamable(r, file)).toBeInstanceOf(StreamableFile);
    expect(r.set).toHaveBeenCalledWith({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="r.pdf"' });
  });

  it('ReportsController returns JSON by default and files for xlsx/pdf', async () => {
    const s = {
      ownerStatement: jest.fn().mockResolvedValue('json'), exportOwnerStatement: jest.fn().mockResolvedValue(file),
      paymentsReport: jest.fn().mockResolvedValue('json'), exportPayments: jest.fn().mockResolvedValue(file),
      rentRoll: jest.fn().mockResolvedValue('json'), exportRentRoll: jest.fn().mockResolvedValue(file),
      agreementsReport: jest.fn().mockResolvedValue('json'), exportAgreements: jest.fn().mockResolvedValue(file),
      auditLogsReport: jest.fn().mockResolvedValue('json'), exportAuditLogs: jest.fn().mockResolvedValue(file),
      exportAgreementCertificate: jest.fn().mockResolvedValue(file),
    };
    const c = new ReportsController(s as any);
    await expect(c.ownerStatement(USERS.owner, {}, res())).resolves.toBe('json');
    await expect(c.ownerStatement(USERS.owner, { format: 'pdf' }, res())).resolves.toBeInstanceOf(StreamableFile);
    expect(s.exportOwnerStatement).toHaveBeenCalledWith(USERS.owner, undefined, 'pdf', 'EN', undefined);
    await expect(c.payments(USERS.owner, {}, res())).resolves.toBe('json');
    await expect(c.payments(USERS.owner, { format: 'xlsx', lang: 'AM' }, res())).resolves.toBeInstanceOf(StreamableFile);
    await expect(c.rentRoll(USERS.owner, {}, res())).resolves.toBe('json');
    await expect(c.rentRoll(USERS.owner, { format: 'xlsx' }, res())).resolves.toBeInstanceOf(StreamableFile);
    await expect(c.agreements(USERS.admin, {}, res())).resolves.toBe('json');
    await expect(c.agreements(USERS.admin, { format: 'pdf' }, res())).resolves.toBeInstanceOf(StreamableFile);
    await expect(c.auditLogs(USERS.admin, {}, res())).resolves.toBe('json');
    await expect(c.auditLogs(USERS.admin, { format: 'xlsx' }, res())).resolves.toBeInstanceOf(StreamableFile);
    await expect(c.agreementCertificate(USERS.owner, 'agreement-id', {}, res())).resolves.toBeInstanceOf(StreamableFile);
  });
});
