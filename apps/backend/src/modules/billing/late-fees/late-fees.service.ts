import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, InvoiceType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AuditService } from '../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../common/constants/audit-actions.constants';
import { NotificationsService } from '../../core-services/notifications/notifications.service';
import { generateReference } from '../../../common/utils/reference.util';
import { formatDate, startOfDayUtc } from '../../../common/utils/date.util';
import { roundMoney, toNumber } from '../../../common/utils/money.util';
import { outstandingAmount } from '../invoices/utils/billing-period.util';
import { computeLateFee, cycleDueDate, describeLateFee, type LateFeeRuleInput } from './late-fee.util';
import type {
  CreateLateFeeRuleDto,
  LateFeeRuleFilterDto,
  UpdateLateFeeRuleDto,
} from './dto/late-fee.dto';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { isPlatformWide, requireOwnerId } from '../../../common/utils/owner-scope.util';

type Rule = {
  id: string;
  ownerId: string;
  agreementId: string | null;
  label: string;
  type: 'PERCENT' | 'FLAT';
  value: unknown;
  gracePeriodDays: number;
  frequency: 'ONCE' | 'PER_WEEK' | 'PER_MONTH';
  maxPercentOfBalance: unknown;
  appliesTo: InvoiceType[];
  isActive: boolean;
};

@Injectable()
export class LateFeesService {
  private readonly log = new Logger(LateFeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- rule CRUD

  /**
   * Rules the caller may see: their own portfolio rules plus the per-agreement overrides
   * on their agreements. A platform admin can pass `ownerId` to inspect someone else.
   */
  async findRules(user: AuthUser, filter: LateFeeRuleFilterDto) {
    const ownerId = isPlatformWide(user) && filter.ownerId ? filter.ownerId : requireOwnerId(user);
    return this.prisma.lateFeeRule.findMany({
      where: {
        ownerId,
        ...(filter.agreementId ? { agreementId: filter.agreementId } : {}),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
      },
      include: {
        agreement: { select: { id: true, referenceNo: true, unit: { select: { unitNumber: true } } } },
      },
      orderBy: [{ agreementId: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createRule(user: AuthUser, dto: CreateLateFeeRuleDto) {
    const ownerId = requireOwnerId(user);
    if (dto.agreementId) await this.assertAgreementOwned(ownerId, dto.agreementId);
    this.assertSane(dto);

    const rule = await this.prisma.lateFeeRule.create({
      data: {
        ownerId,
        agreementId: dto.agreementId ?? null,
        label: dto.label,
        type: dto.type,
        value: dto.value,
        gracePeriodDays: dto.gracePeriodDays,
        frequency: dto.frequency,
        maxPercentOfBalance: dto.maxPercentOfBalance ?? null,
        appliesTo: dto.appliesTo?.length ? dto.appliesTo : [InvoiceType.RENT],
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.log(
      AUDIT_ACTIONS.LATE_FEE_RULE_CREATED,
      'LateFeeRule',
      rule.id,
      user,
      { label: rule.label, type: rule.type, value: toNumber(rule.value), scope: rule.agreementId ?? 'owner' },
    );
    return rule;
  }

  async updateRule(user: AuthUser, id: string, dto: UpdateLateFeeRuleDto) {
    const rule = await this.assertRuleAccessible(user, id);
    this.assertSane({ ...toRuleInput(rule), ...dto });

    const updated = await this.prisma.lateFeeRule.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.value !== undefined ? { value: dto.value } : {}),
        ...(dto.gracePeriodDays !== undefined ? { gracePeriodDays: dto.gracePeriodDays } : {}),
        ...(dto.frequency !== undefined ? { frequency: dto.frequency } : {}),
        ...(dto.maxPercentOfBalance !== undefined ? { maxPercentOfBalance: dto.maxPercentOfBalance } : {}),
        ...(dto.appliesTo !== undefined ? { appliesTo: dto.appliesTo } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log(AUDIT_ACTIONS.LATE_FEE_RULE_UPDATED, 'LateFeeRule', id, user, {
      changes: Object.keys(dto),
    });
    return updated;
  }

  /** Deactivates rather than deletes, so historic penalties keep their explanation. */
  async removeRule(user: AuthUser, id: string) {
    const rule = await this.assertRuleAccessible(user, id);
    await this.prisma.lateFeeRule.update({ where: { id }, data: { isActive: false } });
    await this.audit.log(AUDIT_ACTIONS.LATE_FEE_RULE_DEACTIVATED, 'LateFeeRule', id, user, {
      label: rule.label,
    });
    return { success: true };
  }

  /**
   * A dry run of what today's job would bill, so an owner can sanity check a rule before
   * the scheduler acts on it. No rows are written.
   */
  async preview(user: AuthUser) {
    const ownerId = requireOwnerId(user);
    const { invoices, rules } = await this.loadTargets(ownerId, new Date());

    const rows = [];
    for (const invoice of invoices) {
      const rule = this.pickRule(rules, invoice.agreementId, invoice.type);
      if (!rule) continue;
      const charged = await this.chargedCycles(invoice.id);
      const result = computeLateFee(
        toRuleInput(rule),
        { outstanding: outstandingAmount(invoice), dueDate: invoice.dueDate, now: new Date() },
        charged,
      );
      if (result.amount <= 0) continue;
      rows.push({
        invoiceNo: invoice.invoiceNo,
        agreementId: invoice.agreementId,
        unit: invoice.unit?.unitNumber ?? null,
        type: invoice.type,
        dueDate: invoice.dueDate,
        daysLate: result.daysLate,
        rule: rule.label,
        amount: result.amount,
        detail: describeLateFee(toRuleInput(rule), result, rule.label),
      });
    }
    return { total: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)), rows };
  }

  // ------------------------------------------------------------ the daily job

  /**
   * Bills late fees across every owner's portfolio.
   *
   * Idempotency comes from `@@unique([penaltyForInvoiceId, penaltyCycle])`: a given cycle
   * of a given invoice can only be charged once, so re-running the job — or retrying after
   * a partial failure — can never double-charge a tenant.
   */
  async generateLateFeePenalties(now: Date = new Date()): Promise<number> {
    const owners = await this.prisma.user.findMany({
      where: { role: 'OWNER', isSuspended: false },
      select: { id: true },
    });

    let created = 0;
    for (const owner of owners) {
      try {
        created += await this.generateForOwner(owner.id, now);
      } catch (error) {
        // One owner's bad data must never stop the rest of the platform.
        this.log.error(`late fees failed for owner ${owner.id}: ${(error as Error).message}`);
      }
    }
    return created;
  }

  private async generateForOwner(ownerId: string, now: Date): Promise<number> {
    const { invoices, rules } = await this.loadTargets(ownerId, now);
    if (!invoices.length || !rules.length) return 0;

    let created = 0;
    for (const invoice of invoices) {
      const rule = this.pickRule(rules, invoice.agreementId, invoice.type);
      if (!rule) continue;

      const charged = await this.chargedCycles(invoice.id);
      const outstanding = outstandingAmount(invoice);
      const result = computeLateFee(
        toRuleInput(rule),
        { outstanding, dueDate: invoice.dueDate, now },
        charged,
      );
      if (result.amount <= 0 || result.newCycles <= 0) continue;

      // Bill only the newly-due cycles, then re-apply the cap against what is already
      // been charged, so running the job repeatedly walks up to the cap instead of
      // billing the whole capped amount on the first run.
      const amount = this.amountForNewCycles(toRuleInput(rule), outstanding, result.feePerCycle, result.newCycles, charged);
      if (amount <= 0) continue;

      const periodStart = cycleDueDate(toRuleInput(rule), invoice.dueDate, result.cycles);
      try {
        await this.prisma.invoice.create({
          data: {
            invoiceNo: generateReference('INV'),
            agreementId: invoice.agreementId,
            tenantId: invoice.tenantId,
            ownerId: invoice.ownerId,
            propertyId: invoice.propertyId,
            unitId: invoice.unitId,
            type: InvoiceType.PENALTY,
            periodStart,
            periodEnd: startOfDayUtc(now),
            dueDate: startOfDayUtc(now),
            amount,
            currency: invoice.currency,
            status: InvoiceStatus.UNPAID,
            description: describeLateFee(toRuleInput(rule), result, rule.label),
            penaltyForInvoiceId: invoice.id,
            penaltyCycle: result.cycles,
            penaltyRuleId: rule.id,
          },
        });
        created += 1;

        await this.notifications.notify(
          [invoice.tenantId],
          'RENT_LATE_FEE',
          {
            amount,
            unit: invoice.unit?.unitNumber ?? undefined,
            days: String(result.daysLate),
            dueDate: formatDate(invoice.dueDate),
          },
          { sms: true, data: { penaltyForInvoiceId: invoice.id } },
        );
        await this.audit.log(AUDIT_ACTIONS.LATE_FEE_APPLIED, 'Invoice', invoice.id, null, {
          penalty: amount,
          cycle: result.cycles,
          rule: rule.label,
          daysLate: result.daysLate,
        });
      } catch (error) {
        // A unique violation means a concurrent run already billed this exact cycle.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
    return created;
  }

  /**
   * Caps the total that may ever be charged on one invoice.
   * `maxPercentOfBalance` is a share of the unpaid balance, so it has to be measured
   * against everything already billed rather than applied per cycle.
   */
  private amountForNewCycles(
    rule: LateFeeRuleInput,
    outstanding: number,
    feePerCycle: number,
    newCycles: number,
    alreadyChargedCycles: number,
  ): number {
    const uncapped = roundMoney(feePerCycle * newCycles);
    const maxPercent =
      rule.maxPercentOfBalance === null || rule.maxPercentOfBalance === undefined
        ? null
        : toNumber(rule.maxPercentOfBalance);
    if (maxPercent === null || maxPercent <= 0) return uncapped;
    const cap = roundMoney((outstanding * maxPercent) / 100);
    const alreadyBilled = roundMoney(feePerCycle * alreadyChargedCycles);
    return Math.max(0, Math.min(uncapped, cap - alreadyBilled));
  }

  /** Overdue, still partly unpaid invoices that a rule could act on. */
  private async loadTargets(ownerId: string, now: Date) {
    const overdue = await this.prisma.invoice.findMany({
      where: {
        ownerId,
        type: { in: [InvoiceType.RENT, InvoiceType.DEPOSIT] },
        status: InvoiceStatus.OVERDUE,
        dueDate: { lt: startOfDayUtc(now) },
      },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        invoiceNo: true,
        agreementId: true,
        tenantId: true,
        ownerId: true,
        propertyId: true,
        unitId: true,
        type: true,
        dueDate: true,
        amount: true,
        amountPaid: true,
        currency: true,
        unit: { select: { unitNumber: true } },
      },
    });
    // Prisma cannot compare two columns in one where clause, so drop fully-settled rows here.
    const invoices = overdue.filter((invoice) => outstandingAmount(invoice) > 0);
    const rules = (await this.prisma.lateFeeRule.findMany({
      where: { ownerId, isActive: true },
    })) as Rule[];
    return { invoices, rules };
  }

  /** An agreement-specific rule beats the owner's default; first match wins. */
  private pickRule(rules: Rule[], agreementId: string, invoiceType: InvoiceType): Rule | null {
    const applicable = rules.filter((rule) => rule.isActive && rule.appliesTo.includes(invoiceType));
    return (
      applicable.find((rule) => rule.agreementId === agreementId) ??
      applicable.find((rule) => rule.agreementId === null) ??
      null
    );
  }

  /** The highest cycle already billed against this invoice. */
  private async chargedCycles(invoiceId: string): Promise<number> {
    const rows = await this.prisma.invoice.findMany({
      where: { penaltyForInvoiceId: invoiceId, type: InvoiceType.PENALTY },
      select: { penaltyCycle: true },
    });
    return rows.reduce((max, row) => Math.max(max, row.penaltyCycle ?? 0), 0);
  }

  // ------------------------------------------------------------------ guards

  private assertSane(rule: {
    type?: string;
    value?: unknown;
    gracePeriodDays?: number;
    maxPercentOfBalance?: unknown;
  }) {
    if (rule.value !== undefined && toNumber(rule.value) <= 0) {
      throw new BadRequestException('Late fee value must be greater than zero');
    }
    if (rule.type === 'PERCENT' && rule.value !== undefined && toNumber(rule.value) > 100) {
      throw new BadRequestException('A percentage late fee cannot exceed 100');
    }
    if (rule.gracePeriodDays !== undefined && (rule.gracePeriodDays < 0 || rule.gracePeriodDays > 90)) {
      throw new BadRequestException('Grace period must be between 0 and 90 days');
    }
    if (rule.maxPercentOfBalance !== undefined && rule.maxPercentOfBalance !== null) {
      if (toNumber(rule.maxPercentOfBalance) <= 0) {
        throw new BadRequestException('The cap must be greater than zero, or left empty for no cap');
      }
      if (toNumber(rule.maxPercentOfBalance) > 100) {
        throw new BadRequestException('The cap cannot exceed 100% of the unpaid balance');
      }
    }
  }

  private async assertAgreementOwned(ownerId: string, agreementId: string) {
    const agreement = await this.prisma.agreement.findFirst({
      where: { id: agreementId, ownerId },
      select: { id: true },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
  }

  private async assertRuleAccessible(user: AuthUser, id: string) {
    const rule = await this.prisma.lateFeeRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Late fee rule not found');
    if (!isPlatformWide(user) && rule.ownerId !== requireOwnerId(user)) {
      throw new ForbiddenException('That rule belongs to another owner');
    }
    return rule;
  }
}

function toRuleInput(rule: Rule): LateFeeRuleInput {
  return {
    type: rule.type,
    value: rule.value,
    gracePeriodDays: rule.gracePeriodDays,
    frequency: rule.frequency,
    maxPercentOfBalance: rule.maxPercentOfBalance,
  };
}
