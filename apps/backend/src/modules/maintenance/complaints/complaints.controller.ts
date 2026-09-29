import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { ComplaintsService } from './complaints.service';
import {
  AdminResolveComplaintDto, ComplaintFilterDto, CreateComplaintDto, EscalateComplaintDto, RespondComplaintDto, UpdateComplaintStatusDto,
} from './dto/complaint.dto';

@ApiTags('Complaints & Maintenance Requests')
@ApiBearerAuth('access-token')
@Controller('complaints')
export class ComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  @Post()
  @Roles(UserRole.TENANT, UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Submit a complaint / maintenance report (FR-TEN-05)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateComplaintDto) {
    return this.complaintsService.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Tenant: mine · Owner: inbox · Admin: escalated or unresolved past SLA' })
  findAll(@CurrentUser() user: AuthUser, @Query() filter: ComplaintFilterDto) {
    return this.complaintsService.findAll(user, filter);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.complaintsService.findOne(user, id);
  }

  @Patch(':id/status')
  @Roles(UserRole.TENANT, UserRole.OWNER, UserRole.MANAGER)
  updateStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateComplaintStatusDto) {
    return this.complaintsService.updateStatus(user, id, dto);
  }

  @Post(':id/responses')
  @ApiOperation({ summary: 'Reply on the complaint thread (FR-OWN-05)' })
  respond(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondComplaintDto) {
    return this.complaintsService.respond(user, id, dto);
  }

  @Post(':id/escalate')
  @Roles(UserRole.TENANT, UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Escalate to the platform admin (FR-OWN-05)' })
  escalate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EscalateComplaintDto) {
    return this.complaintsService.escalate(user, id, dto);
  }

  @Post(':id/admin-resolve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin resolves an escalated dispute (FR-ADM-03)' })
  adminResolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminResolveComplaintDto) {
    return this.complaintsService.adminResolve(user, id, dto);
  }
}
