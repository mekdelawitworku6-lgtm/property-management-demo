import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/** Optional Telegram notification gateway (Section 4.1.6). Disabled without TELEGRAM_BOT_TOKEN. */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.configService.get<string>('TELEGRAM_BOT_TOKEN'));
  }

  async send(chatId: string, text: string): Promise<boolean> {
    if (!chatId || !text || !this.isEnabled()) return false;
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        { chat_id: chatId, text },
        { timeout: 10_000 },
      );
      return true;
    } catch (error) {
      this.logger.warn(`Telegram send to ${chatId} failed: ${(error as Error).message}`);
      return false;
    }
  }
}
