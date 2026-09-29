import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { ListingsService } from './listings.service';
import { ListingFilterDto } from './dto/listing-filter.dto';

@ApiTags('Listings (Tenant browse)')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse available units — filter by location, price, type (FR-TEN-01)' })
  search(@Query() filter: ListingFilterDto) {
    return this.listingsService.search(filter);
  }

  @Public()
  @Get('locations')
  @ApiOperation({ summary: 'Cities / sub-cities with available units' })
  locations() {
    return this.listingsService.locations();
  }

  @Public()
  @Get(':unitId')
  @ApiOperation({ summary: 'Listing detail' })
  findOne(@Param('unitId', ParseUUIDPipe) unitId: string) {
    return this.listingsService.findOne(unitId);
  }
}
