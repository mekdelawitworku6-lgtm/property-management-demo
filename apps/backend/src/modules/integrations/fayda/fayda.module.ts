import { Module } from '@nestjs/common';
import { FaydaMockService } from './fayda-mock.service';

@Module({
  providers: [FaydaMockService],
  exports: [FaydaMockService],
})
export class FaydaModule {}
