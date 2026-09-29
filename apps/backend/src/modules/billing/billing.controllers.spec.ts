import { USERS } from '../../test-utils/mocks';
import { InvoicesController } from './invoices/invoices.controller';
import { PaymentsController } from './payments/payments.controller';
import { PayoutsController } from './payouts/payouts.controller';
import { ExpensesController } from './expenses/expenses.controller';

const svc = (...methods: string[]) => Object.fromEntries(methods.map((m) => [m, jest.fn().mockResolvedValue(m)]));

describe('Billing controllers', () => {
  it('InvoicesController delegates', async () => {
    const s = svc('findAll', 'getBalances', 'findOne', 'createManual', 'cancel', 'getSchedule');
    const c = new InvoicesController(s as any);
    await expect(c.findAll(USERS.owner, {})).resolves.toBe('findAll');
    await expect(c.balances(USERS.owner)).resolves.toBe('getBalances');
    await expect(c.findOne(USERS.owner, 'i')).resolves.toBe('findOne');
    await expect(c.createManual(USERS.owner, {} as any)).resolves.toBe('createManual');
    await expect(c.cancel(USERS.owner, 'i', { reason: 'r' })).resolves.toBe('cancel');
    expect(s.cancel).toHaveBeenCalledWith(USERS.owner, 'i', 'r');
    await expect(c.schedule(USERS.owner, 'a')).resolves.toBe('getSchedule');
  });

  it('PaymentsController delegates, including the raw webhook body', async () => {
    const s = svc('initiateTelebirr', 'submitBankTransfer', 'recordOffline', 'handleTelebirrWebhook', 'completeMockCheckout', 'findAll', 'findOne', 'confirm', 'reject', 'reconcileTelebirr');
    const c = new PaymentsController(s as any);
    await expect(c.initiateTelebirr(USERS.tenant, {} as any)).resolves.toBe('initiateTelebirr');
    await expect(c.submitBankTransfer(USERS.tenant, {} as any)).resolves.toBe('submitBankTransfer');
    await expect(c.recordOffline(USERS.owner, {} as any)).resolves.toBe('recordOffline');
    const raw = Buffer.from('{}');
    await c.telebirrWebhook({ rawBody: raw } as any);
    expect(s.handleTelebirrWebhook).toHaveBeenLastCalledWith(raw);
    await c.telebirrWebhook({ body: '<xml/>' } as any);
    expect(s.handleTelebirrWebhook).toHaveBeenLastCalledWith('<xml/>');
    await c.telebirrWebhook({ body: { a: 1 } } as any);
    expect(s.handleTelebirrWebhook).toHaveBeenLastCalledWith('{"a":1}');
    await expect(c.mockCheckout('PAY')).resolves.toBe('completeMockCheckout');
    await expect(c.findAll(USERS.tenant, {})).resolves.toBe('findAll');
    await expect(c.findOne(USERS.tenant, 'p')).resolves.toBe('findOne');
    await expect(c.confirm(USERS.telecom, 'p', {})).resolves.toBe('confirm');
    await expect(c.reject(USERS.telecom, 'p', { reason: 'x' })).resolves.toBe('reject');
    await expect(c.reconcile(USERS.telecom, 'p')).resolves.toBe('reconcileTelebirr');
  });

  it('PayoutsController delegates', async () => {
    const s = svc('preview', 'generate', 'findAll', 'findOne', 'markPaid');
    const c = new PayoutsController(s as any);
    await expect(c.preview(USERS.owner, {} as any)).resolves.toBe('preview');
    await expect(c.generate(USERS.admin, {} as any)).resolves.toBe('generate');
    await expect(c.findAll(USERS.owner, {})).resolves.toBe('findAll');
    await expect(c.findOne(USERS.owner, 'p')).resolves.toBe('findOne');
    await expect(c.markPaid(USERS.admin, 'p', {} as any)).resolves.toBe('markPaid');
  });

  it('ExpensesController delegates', async () => {
    const s = svc('create', 'findAll', 'update', 'remove');
    const c = new ExpensesController(s as any);
    await expect(c.create(USERS.owner, {} as any)).resolves.toBe('create');
    await expect(c.findAll(USERS.owner, {})).resolves.toBe('findAll');
    await expect(c.update(USERS.owner, 'e', {})).resolves.toBe('update');
    await expect(c.remove(USERS.owner, 'e')).resolves.toBe('remove');
  });
});
