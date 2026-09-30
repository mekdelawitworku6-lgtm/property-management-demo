import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { AuditRead } from '../../../common/decorators/audit-read.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { UnitsService } from './units.service';
import { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';

@ApiTags('Units')
@ApiBearerAuth('access-token')
@Controller()
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Post('properties/:propertyId/units')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.UNIT_MANAGE)
  @ApiOperation({ summary: 'Add a unit to a property (FR-OWN-02)' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateUnitDto,
  ) {
    return this.unitsService.create(user, propertyId, dto);
  }

  @Get('properties/:propertyId/units')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN, UserRole.TELECOM)
  @RequirePermissions(ManagerPermission.PROPERTY_VIEW)
  @AuditRead('Unit')
  findByProperty(@CurrentUser() user: AuthUser, @Param('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.unitsService.findByProperty(user, propertyId);
  }

  @Get('units/:id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN, UserRole.TELECOM)
  @RequirePermissions(ManagerPermission.PROPERTY_VIEW)
  @AuditRead('Unit')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.unitsService.findOne(user, id);
  }

  @Patch('units/:id')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.UNIT_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUnitDto) {
    return this.unitsService.update(user, id, dto);
  }

  @Delete('units/:id')
  @Roles(UserRole.OWNER)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.unitsService.remove(user, id);
  }
}
