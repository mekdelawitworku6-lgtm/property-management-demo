import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { AuditRead } from '../../../common/decorators/audit-read.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { WorkOrdersService } from './work-orders.service';
import { CompleteWorkOrderDto, CreateWorkOrderDto, UpdateWorkOrderDto, WorkOrderFilterDto } from './dto/work-order.dto';

@ApiTags('Work Orders')
@ApiBearerAuth('access-token')
@Controller('work-orders')
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class WorkOrdersController {
  constructor(private readonly workOrdersService: WorkOrdersService) {}

  @Post()
  @RequirePermissions(ManagerPermission.COMPLAINT_MANAGE)
  @ApiOperation({ summary: 'Create a work order (optionally from a complaint)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkOrderDto) {
    return this.workOrdersService.create(user, dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN)
  @RequirePermissions(ManagerPermission.COMPLAINT_VIEW)
  @AuditRead('WorkOrder')
  findAll(@CurrentUser() user: AuthUser, @Query() filter: WorkOrderFilterDto) {
    return this.workOrdersService.findAll(user, filter);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN)
  @RequirePermissions(ManagerPermission.COMPLAINT_VIEW)
  @AuditRead('WorkOrder')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrdersService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions(ManagerPermission.COMPLAINT_MANAGE)
  @ApiOperation({ summary: 'Assign vendor / update status, schedule, cost estimate' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkOrderDto) {
    return this.workOrdersService.update(user, id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions(ManagerPermission.COMPLAINT_MANAGE)
  @ApiOperation({ summary: 'Record completion + actual cost (logged as expense)' })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteWorkOrderDto) {
    return this.workOrdersService.complete(user, id, dto);
  }

  @Patch(':id/cancel')
  @RequirePermissions(ManagerPermission.COMPLAINT_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrdersService.cancel(user, id);
  }
}
