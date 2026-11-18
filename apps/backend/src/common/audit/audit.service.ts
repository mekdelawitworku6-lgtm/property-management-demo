import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../types/auth-user.type';
import { buildPaginatedList, resolvePagination } from '../utils/paginated-list.util';
import { AUDIT_ACTIONS, type AuditAction } from '../constants/audit-actions.constants';

const SENSITIVE_KEYS = new Set(['password', 'passwordhash', 'otp', 'code', 'token', 'refreshtoken', 'idnumber', 'secret']);

/** Removes secrets from audit metadata (recursively, max depth 5). */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => sanitizeMetadata(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const maybeDecimal = value as { toNumber?: () => number };
    if (typeof maybeDecimal.toNumber === 'function') return maybeDecimal.toNumber();
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[redacted]' : sanitizeMetadata(val, depth + 1);
    }
    return result;
  }
  return value;
}

export interface AuditLogFilter {
  page?: number;
  limit?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: string;
  to?: string;
  /** Owner trail: set false to hide the read/view trail and show only real changes. */
  includeViews?: boolean;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Records an audit entry with timestamp + actor. Never throws — auditing must not break business flows. */
  async log(
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    actor: Pick<AuthUser, 'id' | 'role' | 'ip'> | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          entityType,
          entityId,
          actorId: actor?.id ?? null,
          actorRole: actor?.role ?? 'SYSTEM',
          ipAddress: actor?.ip ?? null,
          metadata: metadata ? (sanitizeMetadata(metadata) as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to persist audit log ${action}: ${(error as Error).message}`);
    }
  }

  async findAll(filter: AuditLogFilter = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.AuditLogWhereInput = {};
    if (filter.action) where.action = filter.action;
    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.actorId) where.actorId = filter.actorId;
    if (filter.includeViews === false) {
      where.action = { not: AUDIT_ACTIONS.RECORD_VIEWED };
    }
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: new Date(filter.from) } : {}),
        ...(filter.to ? { lte: new Date(filter.to) } : {}),
      };
    }
    const [docs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, fullName: true, role: true, phoneNumber: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  /**
   * Activity trail for one owner: everything done by the owner themselves or by
   * the staff they employ. Owners cannot see any other account's activity.
   *
   * Platform staff can also manage an owner's staff, and the owner must see
   * that: an entry is included when it *touches* one of their staff accounts
   * even if the actor is a platform admin, otherwise the platform could quietly
   * revoke a grant and the owner would have no way of knowing.
   */
  async findForOwner(user: AuthUser, filter: AuditLogFilter = {}) {
    const ownerId = user.role === 'OWNER' ? user.id : user.employerId;
    if (!ownerId) return buildPaginatedList([], { page: 1, limit: filter.limit ?? 20, total: 0 });

    const staff = await this.prisma.user.findMany({
      where: { employerId: ownerId, role: 'MANAGER' },
      select: { id: true },
    });

    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.AuditLogWhereInput = {
      OR: [
        { actor: { OR: [{ id: ownerId }, { employerId: ownerId }] } },
        { entityType: 'User', entityId: { in: staff.map((s) => s.id) } },
      ],
    };
    if (filter.action) where.action = filter.action;
    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.actorId) where.actorId = filter.actorId;
    if (filter.includeViews === false) {
      where.action = { not: AUDIT_ACTIONS.RECORD_VIEWED };
    }
    if (filter.from || filter.to) {
      where.createdAt = {
        ...(filter.from ? { gte: new Date(filter.from) } : {}),
        ...(filter.to ? { lte: new Date(filter.to) } : {}),
      };
    }

    const [docs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { id: true, fullName: true, role: true, phoneNumber: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return buildPaginatedList(docs, { page, limit, total });
  }

  /** Full trail for one entity, oldest first. */
  findForEntity(entityType: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { id: true, fullName: true, role: true } } },
    });
  }
}
