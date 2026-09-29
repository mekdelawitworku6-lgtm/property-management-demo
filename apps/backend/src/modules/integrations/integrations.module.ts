import { Module } from '@nestjs/common';
import { SmsModule } from './sms/sms.module';
import { TelebirrModule } from './telebirr/telebirr.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [SmsModule, TelegramModule, TelebirrModule],
})
export class IntegrationsModule {}
