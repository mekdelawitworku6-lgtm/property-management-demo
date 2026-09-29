import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../common/constants/audit-actions.constants';
import { buildPaginatedList, resolvePagination } from '../../common/utils/paginated-list.util';
import type { AuthUser } from '../../common/types/auth-user.type';
import { NotificationsService } from '../core-services/notifications/notifications.service';
import { toPublicUser } from '../core-services/auth/utils/auth-user.util';
import { AdminUserFilterDto, KycDecisionDto, SuspendUserDto } from './dto/admin.dto';

const STAFF_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.TELECOM];

/** Admin Control Dashboard: observe all owners/tenants (FR-ADM-01) and approve/suspend accounts (FR-ADM-02). */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(filter: AdminUserFilterDto = {}) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const where: Prisma.UserWhereInput = {
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.approvalStatus ? { approvalStatus: filter.approvalStatus } : {}),
      ...(filter.isSuspended !== undefined ? { isSuspended: filter.isSuspended } : {}),
      ...(filter.search
        ? {
            OR: [
              { fullName: { contains: filter.search, mode: 'insensitive' } },
              { phoneNumber: { contains: filter.search } },
              { email: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          ownerProfile: true,
          tenantProfile: true,
          _count: { select: { properties: true, tenantAgreements: true, ownerAgreements: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return buildPaginatedList(users.map(toPublicUser), { page, limit, total });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        ownerProfile: true,
        tenantProfile: true,
        employer: { select: { id: true, fullName: true } },
        properties: { select: { id: true, name: true, city: true, isActive: true } },
        tenantAgreements: { select: { id: true, referenceNo: true, status: true, startDate: true, endDate: true } },
        ownerAgreements: { select: { id: true, referenceNo: true, status: true } },
        _count: { select: { tenantComplaints: true, ownerComplaints: true, tenantPayments: true, ownerPayments: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return toPublicUser(user);
  }

  async getTarget(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (STAFF_ROLES.includes(user.role)) throw new BadRequestException('Platform staff accounts are managed separately');
    return user;
  }

  async approve(actor: AuthUser, id: string) {
    await this.getTarget(id);
    const user = await this.prisma.user.update({ where: { id }, data: { approvalStatus: ApprovalStatus.APPROVED } });
    await this.audit.log(AUDIT_ACTIONS.USER_APPROVED, 'User', id, actor);
    await this.notifications.notify([id], 'ACCOUNT_APPROVED', {}, { sms: true });
    return toPublicUser(user);
  }

  async reject(actor: AuthUser, id: string, reason?: string) {
    await this.getTarget(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { approvalStatus: ApprovalStatus.REJECTED, sessionVersion: { increment: 1 }, refreshTokenHash: null },
    });
    await this.audit.log(AUDIT_ACTIONS.USER_REJECTED, 'User', id, actor, { reason });
    return toPublicUser(user);
  }

  /** Suspends the user (and an owner's managers) and revokes their sessions immediately. */
  async suspend(actor: AuthUser, id: string, dto: SuspendUserDto) {
    const target = await this.getTarget(id);
    const data = {
      isSuspended: true,
      suspendedReason: dto.reason,
      suspendedAt: new Date(),
      sessionVersion: { increment: 1 },
      refreshTokenHash: null,
    };
    await this.notifications.notify([id], 'ACCOUNT_SUSPENDED', { reason: dto.reason }, { sms: true });
    const user = await this.prisma.$transaction(async (tx) => {
      if (target.role === UserRole.OWNER) {
        await tx.user.updateMany({ where: { employerId: id }, data });
      }
      return tx.user.update({ where: { id }, data });
    });
    await this.audit.log(AUDIT_ACTIONS.USER_SUSPENDED, 'User', id, actor, { reason: dto.reason });
    return toPublicUser(user);
  }

  async unsuspend(actor: AuthUser, id: string) {
    const target = await this.getTarget(id);
    const data = { isSuspended: false, suspendedReason: null, suspendedAt: null };
    const user = await this.prisma.$transaction(async (tx) => {
      if (target.role === UserRole.OWNER) {
        await tx.user.updateMany({ where: { employerId: id, suspendedReason: target.suspendedReason }, data });
      }
      return tx.user.update({ where: { id }, data });
    });
    await this.audit.log(AUDIT_ACTIONS.USER_UNSUSPENDED, 'User', id, actor);
    return toPublicUser(user);
  }

  async decideKyc(actor: AuthUser, id: string, dto: KycDecisionDto) {
    const profile = await this.prisma.tenantProfile.findUnique({ where: { userId: id } });
    if (!profile) throw new NotFoundException('Tenant profile not found');
    const updated = await this.prisma.tenantProfile.update({ where: { userId: id }, data: { kycStatus: dto.status } });
    await this.audit.log(AUDIT_ACTIONS.KYC_UPDATED, 'User', id, actor, { kycStatus: dto.status });
    const { idNumberEncrypted, ...rest } = updated;
    return { ...rest, hasIdNumber: Boolean(idNumberEncrypted) };
  }
}
