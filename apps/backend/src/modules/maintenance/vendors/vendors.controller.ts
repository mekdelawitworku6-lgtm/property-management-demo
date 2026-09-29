import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { VendorsService } from './vendors.service';
import { CreateVendorDto, UpdateVendorDto, VendorFilterDto } from './dto/vendor.dto';

@ApiTags('Vendors')
@ApiBearerAuth('access-token')
@Controller('vendors')
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Post()
  @ApiOperation({ summary: 'Add a vendor / contractor' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVendorDto) {
    return this.vendorsService.create(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() filter: VendorFilterDto) {
    return this.vendorsService.findAll(user, filter);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vendorsService.findOne(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVendorDto) {
    return this.vendorsService.update(user, id, dto);
  }
}
