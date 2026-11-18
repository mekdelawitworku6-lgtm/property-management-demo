import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { isPlatformWide, resolveOwnerId } from '../../../common/utils/owner-scope.util';
import type { AuthUser } from '../../../common/types/auth-user.type';

const MAX_ROWS = 500;

/** Parses the `since` cursor; missing → full sync (epoch). */
export function parseSince(since?: string): Date {
  if (!since) return new Date(0);
  const date = new Date(since);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('since must be an ISO date');
  return date;
}

/**
 * Delta sync for offline-first clients (PWA / Flutter): returns records the user can see that changed
 * after `since`. Clients store `serverTime` and send it back as the next `since`.
 */
@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async changes(user: AuthUser, sinceParam?: string) {
    // A delta feed is built from one portfolio. Staff appointed by the platform
    // have no portfolio of their own, so there is nothing coherent to sync -
    // silently returning their (empty) tenant scope would look like data loss.
    if (isPlatformWide(user)) throw new BadRequestException('Sync is for owner, manager and tenant clients');
    const since = parseSince(sinceParam);
    const serverTime = new Date();
    const updated = { updatedAt: { gt: since } };
    const ownerId = resolveOwnerId(user);
    const scope = ownerId ? { ownerId } : { tenantId: user.id };
    const take = MAX_ROWS;

    const [properties, units, agreements, invoices, payments, complaints, workOrders, notifications] = await Promise.all([
      ownerId ? this.prisma.property.findMany({ where: { ownerId, ...updated }, take }) : Promise.resolve([]),
      ownerId
        ? this.prisma.unit.findMany({ where: { property: { ownerId }, ...updated }, take })
        : Promise.resolve([]),
      this.prisma.agreement.findMany({ where: { ...scope, ...updated }, take, omit: { content: true } }),
      this.prisma.invoice.findMany({ where: { ...scope, ...updated }, take }),
      this.prisma.payment.findMany({ where: { ...scope, ...updated }, take }),
      this.prisma.complaint.findMany({ where: { ...(scope as Prisma.ComplaintWhereInput), ...updated }, take }),
      ownerId ? this.prisma.workOrder.findMany({ where: { ownerId, ...updated }, take }) : Promise.resolve([]),
      this.prisma.notification.findMany({ where: { userId: user.id, createdAt: { gt: since } }, take }),
    ]);
    const data = { properties, units, agreements, invoices, payments, complaints, workOrders, notifications };
    const hasMore = Object.values(data).some((rows) => rows.length >= MAX_ROWS);
    return { serverTime, since, hasMore, role: user.role as UserRole, ...data };
  }
}
