import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { RentalRequestsService } from './rental-requests.service';
import { CreateRentalRequestDto, RejectRentalRequestDto, RentalRequestFilterDto } from './dto/rental-request.dto';
import { LeaseTermsDto } from '../agreements/dto/agreement.dto';

@ApiTags('Rental Requests')
@ApiBearerAuth('access-token')
@Controller('rental-requests')
export class RentalRequestsController {
  constructor(private readonly rentalRequestsService: RentalRequestsService) {}

  @Post()
  @Roles(UserRole.TENANT)
  @ApiOperation({ summary: 'Request to rent a unit (FR-TEN-02)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRentalRequestDto) {
    return this.rentalRequestsService.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Tenant: my requests · Owner: requests for my units · Admin: all' })
  findAll(@CurrentUser() user: AuthUser, @Query() filter: RentalRequestFilterDto) {
    return this.rentalRequestsService.findAll(user, filter);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rentalRequestsService.findOne(user, id);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.TENANT)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rentalRequestsService.cancel(user, id);
  }

  @Post(':id/accept')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Accept → rental agreement generated for the tenant to sign' })
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() terms: LeaseTermsDto) {
    return this.rentalRequestsService.accept(user, id, terms);
  }

  @Post(':id/reject')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectRentalRequestDto) {
    return this.rentalRequestsService.reject(user, id, dto);
  }
}
