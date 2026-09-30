import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import type { AuthUser } from '../types/auth-user.type';
import { AuditService } from './audit.service';
import { AuditLogFilterDto, OwnerAuditLogFilterDto } from './dto/audit-log-filter.dto';

@ApiTags('Admin - Audit')
@ApiBearerAuth('access-token')
@Controller('admin/audit-logs')
@Roles(UserRole.ADMIN, UserRole.TELECOM)
export class AuditLogsController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Search the platform audit log (FR-ADM-04)' })
  findAll(@Query() filter: AuditLogFilterDto) {
    return this.auditService.findAll(filter);
  }

  @Get(':entityType/:entityId')
  @ApiOperation({ summary: 'Full audit trail for one entity (e.g. Agreement/<id>)' })
  findForEntity(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return this.auditService.findForEntity(entityType, entityId);
  }
}

/** What my staff did (and viewed) - scoped to the caller and their employees. */
@ApiTags('Owner - Activity')
@ApiBearerAuth('access-token')
@Controller('owner/audit-logs')
@Roles(UserRole.OWNER)
export class OwnerAuditLogsController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Activity trail for me and the staff I added' })
  findMine(@CurrentUser() user: AuthUser, @Query() filter: OwnerAuditLogFilterDto) {
    return this.auditService.findForOwner(user, filter);
  }
}
