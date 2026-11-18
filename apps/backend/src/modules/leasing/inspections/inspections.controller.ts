import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { AuditRead } from '../../../common/decorators/audit-read.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { InspectionsService } from './inspections.service';
import {
  CompleteInspectionDto,
  CreateInspectionDto,
  InspectionFilterDto,
} from './dto/inspection.dto';

@ApiTags('Inspections')
@ApiBearerAuth('access-token')
@Controller('inspections')
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class InspectionsController {
  constructor(private readonly inspectionsService: InspectionsService) {}

  @Post()
  @RequirePermissions(ManagerPermission.AGREEMENT_MANAGE)
  @ApiOperation({ summary: 'Schedule a move-in or move-out inspection with photo checklist' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInspectionDto) {
    return this.inspectionsService.create(user, dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN)
  @RequirePermissions(ManagerPermission.AGREEMENT_VIEW)
  @AuditRead('Inspection')
  findAll(@CurrentUser() user: AuthUser, @Query() filter: InspectionFilterDto) {
    return this.inspectionsService.findAll(user, filter);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN)
  @RequirePermissions(ManagerPermission.AGREEMENT_VIEW)
  @AuditRead('Inspection')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inspectionsService.findOne(user, id);
  }

  @Post(':id/complete')
  @RequirePermissions(ManagerPermission.AGREEMENT_MANAGE)
  @ApiOperation({ summary: 'Record checklist results, after photos and completion notes' })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteInspectionDto,
  ) {
    return this.inspectionsService.complete(user, id, dto);
  }

  @Patch(':id/cancel')
  @RequirePermissions(ManagerPermission.AGREEMENT_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.inspectionsService.cancel(user, id);
  }
}
