import { Global, Module } from '@nestjs/common';
import { TelebirrService } from './telebirr.service';

@Global()
@Module({
  providers: [TelebirrService],
  exports: [TelebirrService],
})
export class TelebirrModule {}
