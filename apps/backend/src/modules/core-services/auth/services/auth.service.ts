import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApprovalStatus, OtpPurpose, UserRole } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { AuditService } from '../../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../../common/constants/audit-actions.constants';
import { hashPassword, isStrongPassword, verifyPassword } from '../../../../common/utils/password.util';
import { normalizeEthiopianPhone } from '../../../../common/utils/phone.util';
import type { AuthUser } from '../../../../common/types/auth-user.type';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { ChangePasswordDto, ResetPasswordDto } from '../dto/otp.dto';
import { toPublicUser } from '../utils/auth-user.util';

const PASSWORD_RULE = 'Password must be at least 8 characters and contain a letter and a digit';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly otpService: OtpService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
  ) {}

  requirePhone(phoneNumber: string): string {
    const phone = normalizeEthiopianPhone(phoneNumber);
    if (!phone) throw new BadRequestException('Invalid Ethiopian phone number');
    return phone;
  }

  /** Initial approval state: owners wait for admin approval unless OWNER_AUTO_APPROVE=true (FR-ADM-02). */
  initialApprovalStatus(role: UserRole): ApprovalStatus {
    const key = role === UserRole.OWNER ? 'OWNER_AUTO_APPROVE' : 'TENANT_AUTO_APPROVE';
    const fallback = role === UserRole.OWNER ? 'false' : 'true';
    return this.configService.get<string>(key, fallback) === 'true' ? ApprovalStatus.APPROVED : ApprovalStatus.PENDING;
  }

  /** FR-OWN-01 / tenant sign-up. Creates the account + role profile and sends a phone OTP. */
  async register(dto: RegisterDto) {
    if (!isStrongPassword(dto.password)) throw new BadRequestException(PASSWORD_RULE);
    const phoneNumber = this.requirePhone(dto.phoneNumber);
    const email = dto.email?.trim().toLowerCase() || null;

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ phoneNumber }, ...(email ? [{ email }] : [])] },
    });
    if (existing) throw new ConflictException('An account with this phone number or email already exists');

    const user = await this.prisma.user.create({
      data: {
        role: dto.role,
        fullName: dto.fullName.trim(),
        phoneNumber,
        email,
        passwordHash: await hashPassword(dto.password),
        language: dto.language,
        approvalStatus: this.initialApprovalStatus(dto.role),
        ...(dto.role === UserRole.OWNER
          ? { ownerProfile: { create: { companyName: dto.companyName ?? null } } }
          : { tenantProfile: { create: {} } }),
      },
      include: { ownerProfile: true, tenantProfile: true },
    });

    await this.audit.log(AUDIT_ACTIONS.USER_REGISTERED, 'User', user.id, { id: user.id, role: user.role }, { role: user.role });
    await this.otpService.issue(phoneNumber, OtpPurpose.VERIFY_PHONE, user.language).catch(() => undefined);
    const tokens = await this.tokenService.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  /** Login with phone number or email + password. */
  async login(dto: LoginDto, ip?: string) {
    const identifier = dto.identifier.trim();
    const phone = normalizeEthiopianPhone(identifier);
    const user = await this.prisma.user.findFirst({
      where: phone ? { phoneNumber: phone } : { email: identifier.toLowerCase() },
      include: { ownerProfile: true, tenantProfile: true },
    });
    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.isSuspended) throw new UnauthorizedException(user.suspendedReason ?? 'Account is suspended');
    if (user.approvalStatus === ApprovalStatus.REJECTED) {
      throw new UnauthorizedException('Account registration was rejected');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log(AUDIT_ACTIONS.USER_LOGIN, 'User', user.id, { id: user.id, role: user.role, ip });
    const tokens = await this.tokenService.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  async refresh(refreshToken: string) {
    const user = await this.tokenService.verifyRefreshToken(refreshToken);
    return this.tokenService.issueTokens(user);
  }

  async logout(userId: string): Promise<{ loggedOut: true }> {
    await this.tokenService.revokeAll(userId);
    return { loggedOut: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { ownerProfile: true, tenantProfile: true, employer: { select: { id: true, fullName: true } } },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return toPublicUser(user);
  }

  /** Sends an OTP. For password reset, never reveals whether the phone is registered. */
  async sendOtp(phoneNumber: string, purpose: OtpPurpose) {
    const phone = this.requirePhone(phoneNumber);
    const user = await this.prisma.user.findUnique({ where: { phoneNumber: phone } });
    if (!user) {
      if (purpose === OtpPurpose.RESET_PASSWORD) return { sent: true };
      throw new BadRequestException('No account with this phone number');
    }
    if (purpose === OtpPurpose.VERIFY_PHONE && user.phoneVerified) {
      throw new BadRequestException('Phone number already verified');
    }
    await this.otpService.issue(phone, purpose, user.language);
    return { sent: true };
  }

  async verifyPhone(phoneNumber: string, code: string) {
    const phone = this.requirePhone(phoneNumber);
    await this.otpService.verify(phone, OtpPurpose.VERIFY_PHONE, code);
    await this.prisma.user.update({ where: { phoneNumber: phone }, data: { phoneVerified: true } });
    return { phoneVerified: true };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    if (!isStrongPassword(dto.newPassword)) throw new BadRequestException(PASSWORD_RULE);
    const record = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!record || !(await verifyPassword(dto.currentPassword, record.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(dto.newPassword) },
    });
    await this.tokenService.revokeAll(user.id);
    await this.audit.log(AUDIT_ACTIONS.PASSWORD_CHANGED, 'User', user.id, user);
    return { passwordChanged: true };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (!isStrongPassword(dto.newPassword)) throw new BadRequestException(PASSWORD_RULE);
    const phone = this.requirePhone(dto.phoneNumber);
    await this.otpService.verify(phone, OtpPurpose.RESET_PASSWORD, dto.code);
    const user = await this.prisma.user.update({
      where: { phoneNumber: phone },
      data: { passwordHash: await hashPassword(dto.newPassword), phoneVerified: true },
    });
    await this.tokenService.revokeAll(user.id);
    await this.audit.log(AUDIT_ACTIONS.PASSWORD_RESET, 'User', user.id, { id: user.id, role: user.role });
    return { passwordReset: true };
  }
}
