import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { AuditRead } from '../../../common/decorators/audit-read.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboards')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('owner')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.PROPERTY_VIEW)
  @ApiQuery({ name: 'month', required: false, example: '2026-09' })
  @ApiOperation({ summary: 'Owner dashboard: occupancy, rent collected vs expected, tenants, maintenance (FR-OWN-03)' })
  owner(@CurrentUser() user: AuthUser, @Query('month') month?: string) {
    return this.dashboardService.ownerDashboard(user, month);
  }

  @Get('tenant')
  @Roles(UserRole.TENANT)
  @ApiOperation({ summary: 'Tenant home: leases, balance, next due, complaints' })
  tenant(@CurrentUser() user: AuthUser) {
    return this.dashboardService.tenantDashboard(user);
  }

  @Get('admin')
  @Roles(UserRole.ADMIN, UserRole.TELECOM)
  @ApiQuery({ name: 'month', required: false, example: '2026-09' })
  @ApiOperation({ summary: 'Platform-wide overview (FR-ADM-01, FR-ADM-05)' })
  admin(@Query('month') month?: string) {
    return this.dashboardService.adminDashboard(month);
  }
}
