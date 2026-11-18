import { Module } from '@nestjs/common';
import { DepositRefundsController } from './deposit-refunds.controller';
import { DepositRefundsService } from './deposit-refunds.service';
import { InspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';

@Module({
  controllers: [InspectionsController, DepositRefundsController],
  providers: [InspectionsService, DepositRefundsService],
  exports: [InspectionsService, DepositRefundsService],
})
export class InspectionsModule {}
