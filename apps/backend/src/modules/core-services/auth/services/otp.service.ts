import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Language, OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { SmsService } from '../../../integrations/sms/sms.service';
import { generateNumericCode, safeEqual, sha256 } from '../../../../common/utils/crypto.util';
import { translate } from '../../../../common/i18n/messages';

const RESEND_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly configService: ConfigService,
  ) {}

  private ttlMinutes(): number {
    return Number(this.configService.get('OTP_TTL_MINUTES', 5));
  }

  private maxAttempts(): number {
    return Number(this.configService.get('OTP_MAX_ATTEMPTS', 5));
  }

  /** Generates, stores (hashed) and SMSes a 6-digit code. Enforces a 60s resend cooldown. */
  async issue(phoneNumber: string, purpose: OtpPurpose, language: Language = Language.EN): Promise<{ expiresAt: Date }> {
    const recent = await this.prisma.otpCode.findFirst({
      where: { phoneNumber, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpException('Please wait a minute before requesting another code', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = generateNumericCode(6);
    const expiresAt = new Date(Date.now() + this.ttlMinutes() * 60_000);
    await this.prisma.otpCode.create({
      data: { phoneNumber, purpose, codeHash: sha256(`${phoneNumber}:${code}`), expiresAt },
    });
    const { body } = translate('OTP', language, { code, minutes: this.ttlMinutes() });
    await this.sms.send(phoneNumber, body);
    return { expiresAt };
  }

  /** Verifies and consumes the latest code. Throws on invalid / expired / too many attempts. */
  async verify(phoneNumber: string, purpose: OtpPurpose, code: string): Promise<void> {
    const otp = await this.prisma.otpCode.findFirst({
      where: { phoneNumber, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Verification code expired or not found');
    }
    if (otp.attempts >= this.maxAttempts()) {
      throw new BadRequestException('Too many attempts. Request a new code');
    }
    if (!safeEqual(otp.codeHash, sha256(`${phoneNumber}:${code}`))) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Invalid verification code');
    }
    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  }
}
