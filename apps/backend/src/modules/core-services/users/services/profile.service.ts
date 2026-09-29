import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { AuditService } from '../../../../common/audit/audit.service';
import { AUDIT_ACTIONS } from '../../../../common/constants/audit-actions.constants';
import { decryptText, encryptText } from '../../../../common/utils/crypto.util';
import { normalizeEthiopianPhone } from '../../../../common/utils/phone.util';
import type { AuthUser } from '../../../../common/types/auth-user.type';
import { toPublicUser } from '../../auth/utils/auth-user.util';
import { UpdateMeDto } from '../dto/update-me.dto';
import { UpdateOwnerProfileDto } from '../dto/owner-profile.dto';
import { UpdateTenantProfileDto } from '../dto/tenant-profile.dto';

/** Masks all but the last 4 characters of an ID number. */
export function maskIdNumber(value: string | null): string | null {
  if (!value) return null;
  return value.length <= 4 ? '****' : `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService,
  ) {}

  private secret(): string {
    return this.configService.get<string>('DATA_ENCRYPTION_KEY');
  }

  /** Builds the tenant-profile write payload, encrypting the ID number and flagging KYC as pending. */
  buildTenantProfileData(dto: UpdateTenantProfileDto): Prisma.TenantProfileUncheckedUpdateInput {
    const data: Prisma.TenantProfileUncheckedUpdateInput = {};
    if (dto.idType !== undefined) data.idType = dto.idType;
    if (dto.idNumber !== undefined) data.idNumberEncrypted = encryptText(dto.idNumber, this.secret());
    if (dto.faydaId !== undefined) data.faydaId = dto.faydaId;
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.occupation !== undefined) data.occupation = dto.occupation;
    if (dto.emergencyContactName !== undefined) data.emergencyContactName = dto.emergencyContactName;
    if (dto.emergencyContactPhone !== undefined) {
      const phone = normalizeEthiopianPhone(dto.emergencyContactPhone);
      if (!phone) throw new BadRequestException('Invalid emergency contact phone number');
      data.emergencyContactPhone = phone;
    }
    if (dto.emergencyContactRelation !== undefined) data.emergencyContactRelation = dto.emergencyContactRelation;
    if (dto.idNumber || dto.faydaId) data.kycStatus = KycStatus.PENDING;
    return data;
  }

  async getProfile(user: AuthUser) {
    const record = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { ownerProfile: true, tenantProfile: true },
    });
    if (!record) throw new NotFoundException('User not found');
    const idNumber = decryptText(record.tenantProfile?.idNumberEncrypted, this.secret());
    const result = toPublicUser(record) as Record<string, any>;
    if (result.tenantProfile) result.tenantProfile.idNumberMasked = maskIdNumber(idNumber);
    return result;
  }

  async updateMe(user: AuthUser, dto: UpdateMeDto) {
    const email = dto.email?.trim().toLowerCase();
    if (email) {
      const taken = await this.prisma.user.findFirst({ where: { email, NOT: { id: user.id } } });
      if (taken) throw new ConflictException('Email is already in use');
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: dto.fullName?.trim(),
        email,
        language: dto.language,
        telegramChatId: dto.telegramChatId,
      },
      include: { ownerProfile: true, tenantProfile: true },
    });
    return toPublicUser(updated);
  }

  async updateOwnerProfile(user: AuthUser, dto: UpdateOwnerProfileDto) {
    return this.prisma.ownerProfile.upsert({
      where: { userId: user.id },
      update: { ...dto },
      create: { userId: user.id, ...dto },
    });
  }

  async updateTenantProfile(user: AuthUser, dto: UpdateTenantProfileDto) {
    const data = this.buildTenantProfileData(dto);
    const profile = await this.prisma.tenantProfile.upsert({
      where: { userId: user.id },
      update: data,
      create: { userId: user.id, ...(data as Prisma.TenantProfileUncheckedCreateInput) },
    });
    if (data.kycStatus) {
      await this.audit.log(AUDIT_ACTIONS.KYC_UPDATED, 'User', user.id, user, { kycStatus: data.kycStatus });
    }
    const { idNumberEncrypted, ...rest } = profile;
    return { ...rest, idNumberMasked: maskIdNumber(decryptText(idNumberEncrypted, this.secret())) };
  }
}
