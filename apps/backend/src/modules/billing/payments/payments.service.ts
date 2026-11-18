import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AgreementStatus, ConfirmationSource, InvoiceStatus, InvoiceType, Payment, PaymentMethod, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { assertCanAccess, isPlatformWide, requireOwnerId, resolveOwnerId, scopeWhere } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { formatDate } from '../../../common/utils/date.util';
import { roundMoney, sumMoney, toNumber } from '../../../common/utils/money.util';
import { generateReference } from '../../../common/utils/reference.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { NotificationsService } from '../../core-services/notifications/notifications.service';
import { RealtimeGateway } from '../../core-services/realtime/realtime.gateway';
import { TelebirrService } from '../../integrations/telebirr/telebirr.service';
import { InvoicesService, OPEN_INVOICE_STATUSES } from '../invoices/invoices.service';
import { allocatePayment, isPrepayment, outstandingAmount } from '../invoices/utils/billing-period.util';
import {
  ConfirmPaymentDto, InitiateTelebirrDto, PaymentFilterDto, RecordOfflinePaymentDto, RejectPaymentDto, SubmitBankTransferDto,
} from './dto/payment.dto';

const PAYMENT_INCLUDE = {
  invoice: { select: { id: true, invoiceNo: true, type: true, periodStart: true, periodEnd: true, status: true } },
  tenant: { select: { id: true, fullName: true, phoneNumber: true } },
  property: { select: { id: true, name: true } },
  agreement: { select: { id: true, referenceNo: true, unitId: true } },
  allocations: {
    select: { invoiceId: true, amount: true, periodEnd: true, invoice: { select: { invoiceNo: true } } },
    orderBy: { periodEnd: 'asc' },
  },
} satisfies Prisma.PaymentInclude;

/** The payment row shape the history endpoints return, with relations from PAYMENT_INCLUDE. */
type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

/**
 * Flattens a payment row into the history shape: which invoices it settled, how many
 * months it covered, and any credit left over. Prisma returns Decimals, so money is
 * converted here rather than in the UI.
 */
function toPaymentRecord(payment: PaymentWithRelations) {
  return {
    ...payment,
    amount: toNumber(payment.amount),
    creditAmount: toNumber(payment.creditAmount),
    allocations: payment.allocations.map((allocation) => ({
      invoiceId: allocation.invoiceId,
      invoiceNo: allocation.invoice.invoiceNo,
      amount: toNumber(allocation.amount),
    })),
  };
}

/** Who may confirm which payment method and which ConfirmationSource that records. */
export function resolveConfirmationSource(user: AuthUser, method: PaymentMethod): ConfirmationSource {
  if (user.role === UserRole.TELECOM) return ConfirmationSource.ETHIO_TELECOM;
  if (user.role === UserRole.ADMIN) return ConfirmationSource.ADMIN;
  if ((user.role === UserRole.OWNER || user.role === UserRole.MANAGER) && method === PaymentMethod.BANK_TRANSFER) {
    return ConfirmationSource.OWNER;
  }
  throw new ForbiddenException('Telebirr payments are confirmed by Ethio Telecom; bank transfers by the owner or Ethio Telecom');
}

/** Rent payments via Telebirr / bank / cash with Ethio Telecom confirmation (FR-TEN-04, FR-ADM-05, 4.1.3). */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly telebirr: TelebirrService,
    private readonly invoices: InvoicesService,
    private readonly configService: ConfigService,
  ) {}

  /** Returns an existing payment for an idempotency key (offline resubmission), else null. */
  async findByClientRef(clientRef?: string): Promise<Payment | null> {
    if (!clientRef) return null;
    return this.prisma.payment.findUnique({ where: { clientRef } });
  }

  /**
   * Loads a payable invoice and resolves how much is being paid.
   *
   * `amount` is deliberately NOT capped at this invoice's balance: paying several months
   * at once is allowed, and the surplus is spread over later invoices by
   * {@link allocatePayment}. Partial payments stay allowed too, so the only check here is
   * that the amount is positive — the upper bound is the agreement-wide prepayment ceiling
   * enforced by {@link assertWithinPrepaymentCeiling}.
   */
  async resolvePayable(invoiceId: string, requestedAmount?: number) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { agreement: { select: { status: true, endDate: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(`Invoice is ${invoice.status}`);
    }
    if (invoice.agreement?.status === AgreementStatus.ACTIVE) {
      await this.invoices.ensureRentInvoicesThrough(invoice.agreementId, invoice.agreement.endDate);
    }
    const pending = await this.prisma.payment.aggregate({
      where: { invoiceId, status: PaymentStatus.PENDING },
      _sum: { amount: true },
    });
    const payable = roundMoney(outstandingAmount(invoice) - toNumber(pending._sum.amount));
    if (payable <= 0) throw new BadRequestException('Invoice is fully covered by pending payments');
    const amount = roundMoney(requestedAmount ?? payable);
    if (amount <= 0) throw new BadRequestException('Amount must be greater than zero');
    return { invoice, amount, payable };
  }

  /**
   * Applies a confirmed payment to the invoices it covers and records the split.
   *
   * The target invoice is settled first, then the surplus rolls onto the agreement's later
   * unpaid rent invoices. Each settled invoice gets a `PaymentAllocation` row so the
   * history can show exactly which months a payment covered, and any money left over is
   * stored as `creditAmount` on the payment.
   */
  private async settleInvoices(
    tx: Prisma.TransactionClient,
    paymentId: string,
    primaryInvoiceId: string,
    primaryInvoice: { id: string; agreementId: string; invoiceNo: string; periodStart: Date; periodEnd: Date; amount: unknown; amountPaid: unknown },
    amount: number,
  ): Promise<void> {
    // Read through the transaction client so the invoices we settle are the ones we just
    // locked in; `this.prisma` could otherwise see a concurrent settlement.
    const later = await tx.invoice.findMany({
      where: {
        agreementId: primaryInvoice.agreementId,
        type: InvoiceType.RENT,
        status: { in: OPEN_INVOICE_STATUSES },
        id: { not: primaryInvoiceId },
      },
      select: { id: true, invoiceNo: true, periodStart: true, periodEnd: true, amount: true, amountPaid: true },
      orderBy: { periodStart: 'asc' },
    });

    const result = allocatePayment([primaryInvoice, ...later], amount);
    const prepaid = isPrepayment(result, roundMoney(toNumber(primaryInvoice.amount) - toNumber(primaryInvoice.amountPaid)));

    for (const allocation of result.allocations) {
      await this.invoices.applyPayment(tx, allocation.invoiceId, allocation.amount);
      await tx.paymentAllocation.create({
        data: {
          paymentId,
          invoiceId: allocation.invoiceId,
          amount: allocation.amount,
          periodEnd: allocation.periodEnd,
        },
      });
    }

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        prepaidMonths: prepaid ? result.monthsCovered : 0,
        creditAmount: prepaid ? result.credit : 0,
        prepaidThrough: prepaid ? result.prepaidThrough : null,
      },
    });
  }

  /**
   * A payment may cover this invoice plus anything still owed later on the agreement, but
   * not more. Without this a fat-fingered amount could bank months of credit by accident.
   */
  private async assertWithinPrepaymentCeiling(
    invoice: { id: string; agreementId: string; amount: unknown; amountPaid: unknown },
    amount: number,
  ): Promise<void> {
    const ceiling = await this.maxPayable(invoice.agreementId, invoice);
    if (amount > ceiling + 0.009) {
      throw new BadRequestException(
        `Amount exceeds what is owed on this agreement. The maximum is ${ceiling} ETB.`,
      );
    }
  }

  /** Upper bound for a prepayment: everything still owed on the agreement, including this invoice. */
  async maxPayable(agreementId: string, invoice: { id: string; amount: unknown; amountPaid: unknown }): Promise<number> {
    const others = await this.prisma.invoice.findMany({
      where: {
        agreementId,
        type: InvoiceType.RENT,
        status: { in: OPEN_INVOICE_STATUSES },
        id: { not: invoice.id },
      },
      select: { amount: true, amountPaid: true },
    });
    const pending = await this.prisma.payment.aggregate({
      where: { agreementId, invoiceId: { not: invoice.id }, status: PaymentStatus.PENDING },
      _sum: { amount: true },
    });
    const futureDue = sumMoney(
      others.map((row) => Math.max(0, toNumber(row.amount) - toNumber(row.amountPaid))),
    );
    return roundMoney(outstandingAmount(invoice) + Math.max(0, futureDue - toNumber(pending._sum.amount)));
  }

  /** FR-TEN-04: tenant starts a Telebirr payment → checkout URL / USSD prompt. */
  async initiateTelebirr(user: AuthUser, dto: InitiateTelebirrDto) {
    const existing = await this.findByClientRef(dto.clientRef);
    if (existing) return { payment: existing, checkout: { paymentUrl: existing.checkoutUrl, mode: 'existing' } };

    const { invoice, amount, payable } = await this.resolvePayable(dto.invoiceId, dto.amount);
    if (invoice.tenantId !== user.id) throw new NotFoundException('Invoice not found');
    await this.assertWithinPrepaymentCeiling(invoice, amount);

    const referenceNo = generateReference('PAY');
    const baseUrl = this.configService.get<string>('BASE_URL', 'http://localhost:4100');
    const checkout = await this.telebirr.createPaymentOrder({
      orderReference: referenceNo,
      amount,
      title: `Rent ${invoice.invoiceNo}`,
      phone: dto.phone ?? user.phoneNumber,
      notifyUrl: `${baseUrl}/api/v1/payments/telebirr/webhook`,
    });
    const payment = await this.prisma.payment.create({
      data: {
        referenceNo,
        invoiceId: invoice.id,
        agreementId: invoice.agreementId,
        tenantId: invoice.tenantId,
        ownerId: invoice.ownerId,
        propertyId: invoice.propertyId,
        amount,
        method: PaymentMethod.TELEBIRR,
        checkoutUrl: checkout.paymentUrl,
        clientRef: dto.clientRef ?? null,
        recordedById: user.id,
      },
    });
    await this.audit.log(AUDIT_ACTIONS.PAYMENT_INITIATED, 'Payment', payment.id, user, { method: 'TELEBIRR', amount, referenceNo });
    return { payment, checkout };
  }

  /** Tenant submits a bank transfer reference for confirmation by the owner / Ethio Telecom. */
  async submitBankTransfer(user: AuthUser, dto: SubmitBankTransferDto) {
    const existing = await this.findByClientRef(dto.clientRef);
    if (existing) return existing;
    const { invoice, amount } = await this.resolvePayable(dto.invoiceId, dto.amount);
    if (invoice.tenantId !== user.id) throw new NotFoundException('Invoice not found');
    await this.assertWithinPrepaymentCeiling(invoice, amount);
    const duplicateRef = await this.prisma.payment.findFirst({
      where: { providerReference: dto.providerReference, method: PaymentMethod.BANK_TRANSFER, status: { not: PaymentStatus.REJECTED } },
    });
    if (duplicateRef) throw new ConflictException('This bank reference has already been submitted');

    const payment = await this.prisma.payment.create({
      data: {
        referenceNo: generateReference('PAY'),
        invoiceId: invoice.id,
        agreementId: invoice.agreementId,
        tenantId: invoice.tenantId,
        ownerId: invoice.ownerId,
        propertyId: invoice.propertyId,
        amount,
        method: PaymentMethod.BANK_TRANSFER,
        bankName: dto.bankName,
        providerReference: dto.providerReference,
        receiptUrl: dto.receiptUrl,
        clientRef: dto.clientRef ?? null,
        recordedById: user.id,
      },
    });
    await this.audit.log(AUDIT_ACTIONS.PAYMENT_INITIATED, 'Payment', payment.id, user, { method: 'BANK_TRANSFER', amount });
    this.realtime.emitToUsers([invoice.ownerId], REALTIME_EVENTS.PAYMENT_UPDATED, payment);
    this.realtime.emitToStaff(REALTIME_EVENTS.PAYMENT_UPDATED, payment);
    return payment;
  }

  /** Owner/manager logs a cash payment (or a bank transfer received directly) — confirmed immediately. */
  async recordOffline(user: AuthUser, dto: RecordOfflinePaymentDto) {
    const ownerId = requireOwnerId(user);
    const existing = await this.findByClientRef(dto.clientRef);
    if (existing) return existing;
    const { invoice, amount } = await this.resolvePayable(dto.invoiceId, dto.amount);
    if (invoice.ownerId !== ownerId) throw new NotFoundException('Invoice not found');
    await this.assertWithinPrepaymentCeiling(invoice, amount);

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          referenceNo: generateReference('PAY'),
          invoiceId: invoice.id,
          agreementId: invoice.agreementId,
          tenantId: invoice.tenantId,
          ownerId,
          propertyId: invoice.propertyId,
          amount,
          method: dto.method,
          bankName: dto.bankName,
          providerReference: dto.providerReference,
          receiptUrl: dto.receiptUrl,
          notes: dto.notes,
          clientRef: dto.clientRef ?? null,
status: PaymentStatus.CONFIRMED,
        confirmationSource: ConfirmationSource.OWNER,
        confirmedById: user.id,
        confirmedAt: new Date(),
        recordedById: user.id,
        },
      });
      await this.settleInvoices(tx, created.id, invoice.id, invoice, amount);
      return created;
    });
    await this.audit.log(AUDIT_ACTIONS.PAYMENT_RECORDED, 'Payment', payment.id, user, { method: dto.method, amount });
    await this.afterConfirmed(payment);
    return payment;
  }

  /** Marks a pending payment CONFIRMED and applies it to the invoice atomically. Idempotent. */
  async confirmInternal(
    paymentId: string,
    source: ConfirmationSource,
    actor: AuthUser | null,
    extra: { providerReference?: string; notes?: string } = {},
  ) {
    const payment = await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!current) throw new NotFoundException('Payment not found');
      if (current.status === PaymentStatus.CONFIRMED) return null;
      if (current.status !== PaymentStatus.PENDING) throw new BadRequestException(`Payment is ${current.status}`);

      // Pending payments carry only invoiceId, so the invoice row is re-read here to get
      // the period fields the allocation spread needs.
      const invoice = current.invoiceId
        ? await tx.invoice.findUnique({ where: { id: current.invoiceId } })
        : null;
      if (current.invoiceId && !invoice) throw new NotFoundException('Invoice not found');

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.CONFIRMED,
          confirmationSource: source,
          confirmedById: actor?.id ?? null,
          confirmedAt: new Date(),
          providerReference: extra.providerReference ?? current.providerReference,
          notes: extra.notes ?? current.notes,
        },
      });
      if (invoice) {
        await this.settleInvoices(tx, paymentId, invoice.id, invoice, toNumber(current.amount));
      }
      return updated;
    });
    if (!payment) return this.prisma.payment.findUnique({ where: { id: paymentId } });
    await this.audit.log(AUDIT_ACTIONS.PAYMENT_CONFIRMED, 'Payment', paymentId, actor, {
      source,
      amount: payment.amount,
      providerReference: payment.providerReference,
    });
    await this.afterConfirmed(payment);
    return payment;
  }

  async afterConfirmed(payment: Payment) {
    const params = { amount: toNumber(payment.amount), reference: payment.referenceNo };
    await this.notifications.notify([payment.tenantId], 'PAYMENT_RECEIVED', params, { sms: true, data: { paymentId: payment.id } });
    await this.notifications.notifyOwner(payment.ownerId, 'PAYMENT_RECEIVED', params, { data: { paymentId: payment.id } });
    this.realtime.emitToUsers([payment.tenantId, payment.ownerId], REALTIME_EVENTS.PAYMENT_UPDATED, payment);
    this.realtime.emitToStaff(REALTIME_EVENTS.PAYMENT_UPDATED, payment);

    // A prepayment means future due dates need no transfer, so the owner is told how far
    // ahead the tenant has paid — otherwise the owner keeps waiting for money that is
    // already in the account.
    if (payment.prepaidThrough && payment.prepaidMonths > 0) {
      await this.notifications.notifyOwner(
        payment.ownerId,
        'RENT_PREPAID',
        {
          amount: toNumber(payment.amount),
          reference: payment.referenceNo,
          months: String(payment.prepaidMonths),
          through: formatDate(payment.prepaidThrough),
        },
        { data: { paymentId: payment.id } },
      );
      this.logger.log(
        `Prepayment ${payment.referenceNo}: ${payment.prepaidMonths} month(s) covered through ${formatDate(payment.prepaidThrough)}`,
      );
    }
  }

  /** FR-ADM-05: manual confirmation by Ethio Telecom / admin, or the owner for bank transfers. */
  async confirm(user: AuthUser, id: string, dto: ConfirmPaymentDto) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    const source = resolveConfirmationSource(user, payment.method);
    if (source === ConfirmationSource.OWNER && payment.ownerId !== resolveOwnerId(user)) {
      throw new NotFoundException('Payment not found');
    }
    return this.confirmInternal(id, source, user, dto);
  }

  async reject(user: AuthUser, id: string, dto: RejectPaymentDto) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Payment not found');
    const source = resolveConfirmationSource(user, payment.method);
    if (source === ConfirmationSource.OWNER && payment.ownerId !== resolveOwnerId(user)) {
      throw new NotFoundException('Payment not found');
    }
    if (payment.status !== PaymentStatus.PENDING) throw new BadRequestException(`Payment is ${payment.status}`);
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { status: PaymentStatus.REJECTED, failureReason: dto.reason, confirmedById: user.id },
    });
    await this.audit.log(AUDIT_ACTIONS.PAYMENT_REJECTED, 'Payment', id, user, { reason: dto.reason });
    await this.notifications.notify([payment.tenantId], 'PAYMENT_REJECTED', {
      reference: payment.referenceNo,
      reason: dto.reason,
    }, { sms: true });
    this.realtime.emitToUsers([payment.tenantId, payment.ownerId], REALTIME_EVENTS.PAYMENT_UPDATED, updated);
    return updated;
  }

  /** Telebirr notify_url handler: verify → match → confirm or fail. Always idempotent. */
  async handleTelebirrWebhook(rawBody: Buffer | string): Promise<{ ok: boolean; reason?: string }> {
    const verification = this.telebirr.verifyCallback(rawBody);
    if (!verification.ok) {
      this.logger.warn(`Rejected Telebirr webhook: ${verification.reason}`);
      return verification;
    }
    const { callback } = this.telebirr.parseCallback(rawBody);
    const payment = await this.prisma.payment.findUnique({ where: { referenceNo: callback.orderReference } });
    if (!payment || payment.method !== PaymentMethod.TELEBIRR) {
      return { ok: false, reason: 'Unknown payment reference' };
    }
    if (payment.status !== PaymentStatus.PENDING) return { ok: true };

    if (!callback.success) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: callback.resultMsg ?? `Telebirr code ${callback.resultCode}` },
      });
      await this.audit.log(AUDIT_ACTIONS.PAYMENT_FAILED, 'Payment', payment.id, null, { resultCode: callback.resultCode });
      this.realtime.emitToUsers([payment.tenantId], REALTIME_EVENTS.PAYMENT_UPDATED, { id: payment.id, status: 'FAILED' });
      return { ok: true };
    }
    if (callback.amount !== null && roundMoney(callback.amount) !== roundMoney(toNumber(payment.amount))) {
      this.logger.error(`Telebirr amount mismatch for ${payment.referenceNo}: ${callback.amount} vs ${payment.amount}`);
      return { ok: false, reason: 'Amount mismatch' };
    }
    await this.confirmInternal(payment.id, ConfirmationSource.TELEBIRR_WEBHOOK, null, {
      providerReference: callback.transId ?? undefined,
    });
    return { ok: true };
  }

  /** Staff reconciliation: query Telebirr for a pending payment's real state. */
  async reconcileTelebirr(user: AuthUser, id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment || payment.method !== PaymentMethod.TELEBIRR) throw new NotFoundException('Telebirr payment not found');
    if (payment.status !== PaymentStatus.PENDING) return payment;
    const result = await this.telebirr.queryOrder(payment.referenceNo);
    if (result.status === 'completed') {
      return this.confirmInternal(id, ConfirmationSource.ETHIO_TELECOM, user, { providerReference: result.transId });
    }
    if (result.status === 'failed') {
      return this.prisma.payment.update({ where: { id }, data: { status: PaymentStatus.FAILED, failureReason: 'Telebirr reports failure' } });
    }
    return payment;
  }

  /** Dev only (TELEBIRR_MOCK=true): simulates the customer completing the Telebirr checkout. */
  async completeMockCheckout(referenceNo: string) {
    if (!this.telebirr.isMock()) throw new ForbiddenException('Mock checkout is disabled');
    const payment = await this.prisma.payment.findUnique({ where: { referenceNo } });
    if (!payment) throw new NotFoundException('Payment not found');
    return this.handleTelebirrWebhook(
      JSON.stringify({ merch_order_id: referenceNo, transId: `MOCK${Date.now()}`, amount: toNumber(payment.amount) }),
    );
  }

  buildWhere(user: AuthUser, filter: PaymentFilterDto): Prisma.PaymentWhereInput {
    return {
      ...scopeWhere(user),
      ...(filter.ownerId && isPlatformWide(user) ? { ownerId: filter.ownerId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.method ? { method: filter.method } : {}),
      ...(filter.propertyId ? { propertyId: filter.propertyId } : {}),
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.agreementId ? { agreementId: filter.agreementId } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: new Date(filter.from) } : {}),
              ...(filter.to ? { lte: new Date(`${filter.to.slice(0, 10)}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };
  }

  /** Payment history — per tenant (FR-TEN-06) / per tenant & property (FR-OWN-06) / platform-wide. */
  async findAll(user: AuthUser, filter: PaymentFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where = this.buildWhere(user, filter);
    const [docs, total, confirmed] = await Promise.all([
      this.prisma.payment.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: PAYMENT_INCLUDE }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({ where: { ...where, status: PaymentStatus.CONFIRMED }, _sum: { amount: true } }),
    ]);
    return {
      ...buildPaginatedList(docs.map(toPaymentRecord), { page, limit, total }),
      totalConfirmed: sumMoney([confirmed._sum.amount]),
    };
  }

  async findOne(user: AuthUser, id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundException('Payment not found');
    assertCanAccess(user, payment);
    return toPaymentRecord(payment);
  }
}
