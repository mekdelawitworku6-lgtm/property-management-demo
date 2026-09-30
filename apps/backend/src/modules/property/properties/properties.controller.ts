import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { AuditRead } from '../../../common/decorators/audit-read.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto, PropertyFilterDto, UpdatePropertyDto } from './dto/property.dto';

@ApiTags('Properties')
@ApiBearerAuth('access-token')
@Controller('properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.PROPERTY_MANAGE)
  @ApiOperation({ summary: 'Register a property (FR-OWN-02)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePropertyDto) {
    return this.propertiesService.create(user, dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN, UserRole.TELECOM)
  @RequirePermissions(ManagerPermission.PROPERTY_VIEW)
  @AuditRead('Property')
  @ApiOperation({ summary: 'Portfolio view with unit occupancy summary' })
  findAll(@CurrentUser() user: AuthUser, @Query() filter: PropertyFilterDto) {
    return this.propertiesService.findAll(user, filter);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN, UserRole.TELECOM)
  @RequirePermissions(ManagerPermission.PROPERTY_VIEW)
  @AuditRead('Property')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.propertiesService.findOne(user, id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.PROPERTY_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePropertyDto) {
    return this.propertiesService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Deactivate a property (soft delete)' })
  deactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.propertiesService.deactivate(user, id);
  }
}
