import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AgreementStatus, ApprovalStatus, ManagerPermission, Prisma, UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../../database/prisma.service';
import { AuditService } from '../../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../../common/constants/audit-actions.constants';
import { ALL_MANAGER_PERMISSIONS } from '../../../../common/constants/manager-permissions.constants';
import { hashPassword, isStrongPassword } from '../../../../common/utils/password.util';
import { normalizeEthiopianPhone } from '../../../../common/utils/phone.util';
import { isPlatformStaff, requireOwnerId } from '../../../../common/utils/owner-scope.util';
import { sumMoney, toNumber } from '../../../../common/utils/money.util';
import type { AuthUser } from '../../../../common/types/auth-user.type';
import { toPublicUser } from '../../auth/utils/auth-user.util';
import { ProfileService } from './profile.service';
import { CreateManagerDto, CreateTenantDto } from '../dto/create-account.dto';

const OUTSTANDING_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'] as const;

/** Owner-side account management: property managers and tenant registration. */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly profileService: ProfileService,
  ) {}

  private async assertPhoneAvailable(phoneNumber: string, email?: string | null): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ phoneNumber }, ...(email ? [{ email }] : [])] },
    });
    if (existing) throw new ConflictException('An account with this phone number or email already exists');
  }

  /**
   * Resolves whose portfolio a *new* staff account belongs to. An owner can only
   * ever act on their own staff. Platform staff may name an owner to attach the
   * account to that portfolio, or omit it to create a platform-wide account that
   * belongs to Possible Technology and can work across every owner.
   *
   * @returns the owner id, or null for a platform-wide account.
   */
  private async resolveEmployerId(actor: AuthUser, ownerId?: string): Promise<string | null> {
    if (actor.role === UserRole.OWNER) return actor.id;
    if (!isPlatformStaff(actor)) throw new ForbiddenException('Not allowed to manage staff accounts');
    if (!ownerId) return null;
    const owner = await this.prisma.user.findFirst({ where: { id: ownerId, role: UserRole.OWNER } });
    if (!owner) throw new NotFoundException('Owner not found');
    return owner.id;
  }

  /**
   * Loads the staff account an update targets. An owner may only reach their own
   * staff; platform staff may reach any, because the account already records the
   * owner it works for, so no owner has to be named for an update.
   */
  private async findManagedManager(actor: AuthUser, managerId: string, ownerId?: string) {
    const where: Prisma.UserWhereInput = {
      id: managerId,
      role: UserRole.MANAGER,
      ...(actor.role === UserRole.OWNER
        ? { employerId: actor.id }
        : ownerId
          ? { employerId: ownerId }
          : {}),
    };
    if (actor.role !== UserRole.OWNER && !isPlatformStaff(actor)) {
      throw new ForbiddenException('Not allowed to manage staff accounts');
    }
    const manager = await this.prisma.user.findFirst({ where });
    if (!manager) throw new NotFoundException('Manager not found');
    return manager;
  }

  async createManager(user: AuthUser, dto: CreateManagerDto, ownerId?: string) {
    const employerId = await this.resolveEmployerId(user, ownerId);
    if (!isStrongPassword(dto.password)) {
      throw new BadRequestException('Password must be at least 8 characters and contain a letter and a digit');
    }
    const phoneNumber = normalizeEthiopianPhone(dto.phoneNumber);
    if (!phoneNumber) throw new BadRequestException('Invalid Ethiopian phone number');
    const email = dto.email?.toLowerCase() ?? null;
    await this.assertPhoneAvailable(phoneNumber, email);

    const manager = await this.prisma.user.create({
      data: {
        role: UserRole.MANAGER,
        fullName: dto.fullName.trim(),
        phoneNumber,
        email,
        language: dto.language,
        passwordHash: await hashPassword(dto.password),
        approvalStatus: ApprovalStatus.APPROVED,
        employerId,
        // An omitted list means the owner did not choose, so fall back to full
        // access for compatibility. An explicitly empty list is a real choice
        // ("grant nothing") and must stay empty: treating it as "not provided"
        // would silently hand out every permission.
        permissions: { set: dto.permissions ? [...new Set(dto.permissions)] : [...ALL_MANAGER_PERMISSIONS] },
      },
    });
    await this.audit.log(AUDIT_ACTIONS.MANAGER_CREATED, 'User', manager.id, user, {
      fullName: manager.fullName,
      permissions: manager.permissions,
      employerId,
    });
    return toPublicUser(manager);
  }

  /** Owner (or platform staff) replaces the capability grants of a staff account. */
  async setManagerPermissions(user: AuthUser, managerId: string, permissions: ManagerPermission[]) {
    const manager = await this.findManagedManager(user, managerId);

    const next = [...new Set(permissions)];
    const updated = await this.prisma.user.update({
      where: { id: managerId },
      data: { permissions: { set: next } },
    });
    await this.audit.log(AUDIT_ACTIONS.MANAGER_PERMISSIONS_UPDATED, 'User', managerId, user, {
      fullName: manager.fullName,
      before: manager.permissions,
      after: next,
      employerId: manager.employerId,
    });
    return toPublicUser(updated);
  }

  async listManagers(user: AuthUser) {
    const managers = await this.prisma.user.findMany({
      where: { employerId: user.id, role: UserRole.MANAGER },
      orderBy: { createdAt: 'desc' },
    });
    return managers.map(toPublicUser);
  }

  /**
   * Every staff account on the platform, with the owner each one works for.
   * Used by the admin staff screen, which is deliberately not owner-scoped.
   */
  async listAllManagers(filter: { search?: string; ownerId?: string; isSuspended?: boolean; skip: number; take: number }) {
    const where: Prisma.UserWhereInput = {
      role: UserRole.MANAGER,
      ...(filter.ownerId ? { employerId: filter.ownerId } : {}),
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
    const [managers, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: filter.skip,
        take: filter.take,
        orderBy: { createdAt: 'desc' },
        include: {
          employer: { select: { id: true, fullName: true, ownerProfile: { select: { companyName: true } } } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { total, docs: managers.map(toPublicUser) };
  }

  /** Owner (or platform staff) deactivates / re-activates a staff account. */
  async setManagerActive(user: AuthUser, managerId: string, active: boolean) {
    const manager = await this.findManagedManager(user, managerId);
    const actor = user.role === UserRole.OWNER ? 'owner' : 'platform staff';
    const updated = await this.prisma.user.update({
      where: { id: managerId },
      data: active
        ? { isSuspended: false, suspendedReason: null, suspendedAt: null }
        : {
            isSuspended: true,
            suspendedReason: `Deactivated by ${actor}`,
            suspendedAt: new Date(),
            sessionVersion: { increment: 1 },
            refreshTokenHash: null,
          },
    });
    await this.audit.log(
      active ? AUDIT_ACTIONS.MANAGER_REACTIVATED : AUDIT_ACTIONS.MANAGER_DEACTIVATED,
      'User',
      managerId,
      user,
      { fullName: manager.fullName, employerId: manager.employerId },
    );
    return toPublicUser(updated);
  }

  /** Owner/manager registers a tenant with contact, ID and emergency-contact details (4.1.2). */
  async createTenant(user: AuthUser, dto: CreateTenantDto) {
    requireOwnerId(user);
    const phoneNumber = normalizeEthiopianPhone(dto.phoneNumber);
    if (!phoneNumber) throw new BadRequestException('Invalid Ethiopian phone number');
    const email = dto.email?.toLowerCase() ?? null;
    await this.assertPhoneAvailable(phoneNumber, email);
    if (dto.password && !isStrongPassword(dto.password)) {
      throw new BadRequestException('Password must be at least 8 characters and contain a letter and a digit');
    }

    const { fullName, password, language, email: _e, phoneNumber: _p, ...profileDto } = dto;
    const profileData = this.profileService.buildTenantProfileData(profileDto);
    const tenant = await this.prisma.user.create({
      data: {
        role: UserRole.TENANT,
        fullName: fullName.trim(),
        phoneNumber,
        email,
        language,
        passwordHash: await hashPassword(password ?? `${randomBytes(12).toString('base64url')}1a`),
        approvalStatus: ApprovalStatus.APPROVED,
        tenantProfile: { create: profileData as Prisma.TenantProfileCreateWithoutUserInput },
      },
      include: { tenantProfile: true },
    });
    await this.audit.log(AUDIT_ACTIONS.TENANT_CREATED_BY_OWNER, 'User', tenant.id, user);
    return toPublicUser(tenant);
  }

  /** Look up an existing tenant by phone (e.g. before creating an agreement for them). */
  async findTenantByPhone(phone: string) {
    const phoneNumber = normalizeEthiopianPhone(phone);
    if (!phoneNumber) throw new BadRequestException('Invalid Ethiopian phone number');
    const tenant = await this.prisma.user.findFirst({
      where: { phoneNumber, role: UserRole.TENANT },
      select: { id: true, fullName: true, phoneNumber: true, isSuspended: true, approvalStatus: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  /** Tenants who have (or had) agreements in the owner's portfolio, with outstanding balance. */
  async listPortfolioTenants(user: AuthUser, search?: string) {
    const ownerId = requireOwnerId(user);
    const tenants = await this.prisma.user.findMany({
      where: {
        role: UserRole.TENANT,
        tenantAgreements: { some: { ownerId } },
        ...(search
          ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { phoneNumber: { contains: search } }] }
          : {}),
      },
      include: {
        tenantProfile: true,
        tenantAgreements: {
          where: { ownerId },
          select: { id: true, referenceNo: true, status: true, unitId: true, propertyId: true, endDate: true, rentAmount: true },
        },
        tenantInvoices: {
          where: { ownerId, status: { in: [...OUTSTANDING_STATUSES] } },
          select: { amount: true, amountPaid: true },
        },
      },
      orderBy: { fullName: 'asc' },
    });
    return tenants.map(({ tenantInvoices, ...tenant }) => ({
      ...(toPublicUser(tenant as any) as object),
      activeAgreements: tenant.tenantAgreements.filter((a) => a.status === AgreementStatus.ACTIVE).length,
      outstandingBalance: sumMoney(tenantInvoices.map((i) => toNumber(i.amount) - toNumber(i.amountPaid))),
    }));
  }

  /** One tenant's profile with agreements, balance and payment history in this owner's portfolio. */
  async getPortfolioTenant(user: AuthUser, tenantId: string) {
    const ownerId = requireOwnerId(user);
    const tenant = await this.prisma.user.findFirst({
      where: { id: tenantId, role: UserRole.TENANT, tenantAgreements: { some: { ownerId } } },
      include: {
        tenantProfile: true,
        tenantAgreements: { where: { ownerId }, include: { unit: true, property: { select: { id: true, name: true } } } },
        tenantInvoices: { where: { ownerId }, orderBy: { dueDate: 'desc' } },
        tenantPayments: { where: { ownerId }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found in your portfolio');
    const outstanding = tenant.tenantInvoices
      .filter((i) => (OUTSTANDING_STATUSES as readonly string[]).includes(i.status))
      .map((i) => toNumber(i.amount) - toNumber(i.amountPaid));
    return { ...(toPublicUser(tenant as any) as object), outstandingBalance: sumMoney(outstanding) };
  }
}
