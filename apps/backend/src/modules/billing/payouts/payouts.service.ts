import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod, PaymentStatus, PayoutStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { assertCanAccess, isPlatformWide, requireOwnerId } from '../../../common/utils/owner-scope.util';
import { buildPaginatedList, resolvePagination } from '../../../common/utils/paginated-list.util';
import { endOfMonthUtc, startOfDayUtc, startOfMonthUtc } from '../../../common/utils/date.util';
import { percentOf, roundMoney, sumMoney } from '../../../common/utils/money.util';
import { generateReference } from '../../../common/utils/reference.util';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { GeneratePayoutDto, MarkPayoutPaidDto, PayoutFilterDto, PreviewPayoutDto } from './dto/payout.dto';

/** Gross / platform fee / net for a set of payment amounts. */
export function calculatePayout(amounts: unknown[], feePercent: number) {
  const grossCollected = sumMoney(amounts);
  const platformFee = percentOf(grossCollected, feePercent);
  return { grossCollected, platformFee, netAmount: roundMoney(grossCollected - platformFee) };
}

export function periodBounds(from: string | Date, to: string | Date) {
  const start = startOfDayUtc(new Date(from));
  const end = new Date(startOfDayUtc(new Date(to)).getTime() + 86_399_999);
  if (end < start) throw new BadRequestException('"to" must be on or after "from"');
  return { start, end };
}

/**
 * Owner payout calculation (Section 4.1.3). Telebirr rent is collected by the platform and
 * paid out to owners minus the platform fee; cash / direct bank payments already reached the owner.
 */
@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
  ) {}

  feePercent(): number {
    return Number(this.configService.get('PLATFORM_FEE_PERCENT', 2));
  }

  eligiblePaymentsWhere(ownerId: string, start: Date, end: Date): Prisma.PaymentWhereInput {
    return {
      ownerId,
      method: PaymentMethod.TELEBIRR,
      status: PaymentStatus.CONFIRMED,
      payoutId: null,
      confirmedAt: { gte: start, lte: end },
    };
  }

  async preview(user: AuthUser, dto: PreviewPayoutDto) {
    const ownerId = isPlatformWide(user) ? dto.ownerId : requireOwnerId(user);
    if (!ownerId) throw new BadRequestException('ownerId is required');
    const { start, end } = periodBounds(dto.from, dto.to);
    const payments = await this.prisma.payment.findMany({
      where: this.eligiblePaymentsWhere(ownerId, start, end),
      select: { id: true, referenceNo: true, amount: true, confirmedAt: true, tenantId: true, propertyId: true },
      orderBy: { confirmedAt: 'asc' },
    });
    const direct = await this.prisma.payment.aggregate({
      where: {
        ownerId,
        status: PaymentStatus.CONFIRMED,
        method: { in: [PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER] },
        confirmedAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
    });
    return {
      ownerId,
      periodStart: start,
      periodEnd: end,
      feePercent: this.feePercent(),
      ...calculatePayout(payments.map((p) => p.amount), this.feePercent()),
      directlyCollected: sumMoney([direct._sum.amount]),
      payments,
    };
  }

  /** Creates a payout covering all unpaid-out Telebirr collections in the period. */
  async generate(user: AuthUser | null, dto: GeneratePayoutDto) {
    const { start, end } = periodBounds(dto.from, dto.to);
    const payout = await this.prisma.$transaction(async (tx) => {
      const payments = await tx.payment.findMany({
        where: this.eligiblePaymentsWhere(dto.ownerId, start, end),
        select: { id: true, amount: true },
      });
      if (!payments.length) return null;
      const totals = calculatePayout(payments.map((p) => p.amount), this.feePercent());
      const created = await tx.payout.create({
        data: { referenceNo: generateReference('PO'), ownerId: dto.ownerId, periodStart: start, periodEnd: end, ...totals },
      });
      await tx.payment.updateMany({
        where: { id: { in: payments.map((p) => p.id) }, payoutId: null },
        data: { payoutId: created.id },
      });
      return created;
    });
    if (!payout) throw new BadRequestException('No Telebirr collections to pay out for this period');
    await this.audit.log(AUDIT_ACTIONS.PAYOUT_GENERATED, 'Payout', payout.id, user, {
      ownerId: dto.ownerId,
      netAmount: payout.netAmount,
    });
    return payout;
  }

  /** Monthly job: payouts for last month for every owner with eligible collections. */
  async generateMonthly(now: Date = new Date()): Promise<number> {
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const start = startOfMonthUtc(lastMonth);
    const end = endOfMonthUtc(lastMonth);
    const owners = await this.prisma.payment.groupBy({
      by: ['ownerId'],
      where: { method: PaymentMethod.TELEBIRR, status: PaymentStatus.CONFIRMED, payoutId: null, confirmedAt: { gte: start, lte: end } },
    });
    let created = 0;
    for (const { ownerId } of owners) {
      await this.generate(null, { ownerId, from: start.toISOString(), to: end.toISOString() });
      created++;
    }
    return created;
  }

  async markPaid(user: AuthUser, id: string, dto: MarkPayoutPaidDto) {
    const payout = await this.prisma.payout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status === PayoutStatus.PAID) throw new BadRequestException('Payout already paid');
    const updated = await this.prisma.payout.update({
      where: { id },
      data: { status: PayoutStatus.PAID, method: dto.method, paidReference: dto.paidReference, paidAt: new Date() },
    });
    await this.audit.log(AUDIT_ACTIONS.PAYOUT_PAID, 'Payout', id, user, { paidReference: dto.paidReference });
    return updated;
  }

  async findAll(user: AuthUser, filter: PayoutFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.PayoutWhereInput = {
      ...(isPlatformWide(user) ? (filter.ownerId ? { ownerId: filter.ownerId } : {}) : { ownerId: requireOwnerId(user) }),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [docs, total] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { owner: { select: { id: true, fullName: true, phoneNumber: true } } },
      }),
      this.prisma.payout.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  async findOne(user: AuthUser, id: string) {
    const payout = await this.prisma.payout.findUnique({
      where: { id },
      include: {
        payments: { select: { id: true, referenceNo: true, amount: true, confirmedAt: true, tenantId: true, propertyId: true } },
        owner: { select: { id: true, fullName: true, ownerProfile: true } },
      },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    assertCanAccess(user, payout);
    return payout;
  }
}
