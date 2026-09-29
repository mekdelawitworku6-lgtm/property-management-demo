import { Module } from '@nestjs/common';
import { PropertiesController } from './properties/properties.controller';
import { PropertiesService } from './properties/properties.service';
import { UnitsController } from './units/units.controller';
import { UnitsService } from './units/units.service';
import { ListingsController } from './listings/listings.controller';
import { ListingsService } from './listings/listings.service';

@Module({
  controllers: [PropertiesController, UnitsController, ListingsController],
  providers: [PropertiesService, UnitsService, ListingsService],
  exports: [PropertiesService, UnitsService, ListingsService],
})
export class PropertyModule {}
