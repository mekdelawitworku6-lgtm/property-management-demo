import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { maskPhone } from '../../../common/utils/phone.util';

/**
 * SMS gateway (preferably Ethio Telecom's bulk SMS / Geez SMS).
 * SMS_MOCK=true logs messages instead of sending them.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly configService: ConfigService) {}

  isMock(): boolean {
    return this.configService.get<string>('SMS_MOCK', 'true') !== 'false' || !this.configService.get('SMS_API_URL');
  }

  /** Sends one SMS. Returns true when delivered to the gateway (or logged in mock mode). Never throws. */
  async send(phoneNumber: string, message: string): Promise<boolean> {
    if (!phoneNumber || !message) return false;
    if (this.isMock()) {
      this.logger.log(`[SMS mock] to ${phoneNumber}: ${message}`);
      return true;
    }
    try {
      await axios.post(
        this.configService.get<string>('SMS_API_URL'),
        {
          phone: phoneNumber,
          msg: message,
          sender_id: this.configService.get<string>('SMS_SENDER_ID') || undefined,
        },
        {
          headers: { 'x-api-key': this.configService.get<string>('SMS_API_KEY') },
          timeout: 10_000,
        },
      );
      return true;
    } catch (error) {
      this.logger.warn(`SMS to ${maskPhone(phoneNumber)} failed: ${(error as Error).message}. Message: ${message}`);
      return false;
    }
  }
}
