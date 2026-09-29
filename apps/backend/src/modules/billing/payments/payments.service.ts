import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfirmationSource, InvoiceStatus, Payment, PaymentMethod, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { REALTIME_EVENTS } from '../../../common/constants/events.constants';
import { assertCanAccess, isPlatformStaff, requireOwnerId, resolveOwnerId, scopeWhere } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { roundMoney, sumMoney, toNumber } from '../../../common/utils/money.util';
import { generateReference } from '../../../common/utils/reference.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { NotificationsService } from '../../core-services/notifications/notifications.service';
import { RealtimeGateway } from '../../core-services/realtime/realtime.gateway';
import { TelebirrService } from '../../integrations/telebirr/telebirr.service';
import { InvoicesService } from '../invoices/invoices.service';
import { outstandingAmount } from '../invoices/utils/billing-period.util';
import {
  ConfirmPaymentDto, InitiateTelebirrDto, PaymentFilterDto, RecordOfflinePaymentDto, RejectPaymentDto, SubmitBankTransferDto,
} from './dto/payment.dto';

const PAYMENT_INCLUDE = {
  invoice: { select: { id: true, invoiceNo: true, type: true, periodStart: true, periodEnd: true, status: true } },
  tenant: { select: { id: true, fullName: true, phoneNumber: true } },
  property: { select: { id: true, name: true } },
  agreement: { select: { id: true, referenceNo: true, unitId: true } },
} satisfies Prisma.PaymentInclude;

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

  /** Loads a payable invoice and resolves the amount (default: outstanding − pending payments). */
  async resolvePayable(invoiceId: string, requestedAmount?: number) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(`Invoice is ${invoice.status}`);
    }
    const pending = await this.prisma.payment.aggregate({
      where: { invoiceId, status: PaymentStatus.PENDING },
      _sum: { amount: true },
    });
    const payable = roundMoney(outstandingAmount(invoice) - toNumber(pending._sum.amount));
    if (payable <= 0) throw new BadRequestException('Invoice is fully covered by pending payments');
    const amount = roundMoney(requestedAmount ?? payable);
    if (amount > payable) throw new BadRequestException(`Amount exceeds the payable balance of ${payable}`);
    return { invoice, amount };
  }

  /** FR-TEN-04: tenant starts a Telebirr payment → checkout URL / USSD prompt. */
  async initiateTelebirr(user: AuthUser, dto: InitiateTelebirrDto) {
    const existing = await this.findByClientRef(dto.clientRef);
    if (existing) return { payment: existing, checkout: { paymentUrl: existing.checkoutUrl, mode: 'existing' } };

    const { invoice, amount } = await this.resolvePayable(dto.invoiceId, dto.amount);
    if (invoice.tenantId !== user.id) throw new NotFoundException('Invoice not found');

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
      await this.invoices.applyPayment(tx, invoice.id, amount);
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
      if (current.invoiceId) await this.invoices.applyPayment(tx, current.invoiceId, toNumber(current.amount));
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
      ...(filter.ownerId && isPlatformStaff(user) ? { ownerId: filter.ownerId } : {}),
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
    return { ...buildPaginatedList(docs, { page, limit, total }), totalConfirmed: sumMoney([confirmed._sum.amount]) };
  }

  async findOne(user: AuthUser, id: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    if (!payment) throw new NotFoundException('Payment not found');
    assertCanAccess(user, payment);
    return payment;
  }
}
