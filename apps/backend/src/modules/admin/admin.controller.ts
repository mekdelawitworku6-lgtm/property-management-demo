import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReasonDto } from '../../common/dto/reason.dto';
import type { AuthUser } from '../../common/types/auth-user.type';
import { AdminUsersService } from './admin-users.service';
import { AdminUserFilterDto, KycDecisionDto, SuspendUserDto } from './dto/admin.dto';

@ApiTags('Admin - Accounts')
@ApiBearerAuth('access-token')
@Controller('admin/users')
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.TELECOM)
  @ApiOperation({ summary: 'All owners / tenants / managers platform-wide (FR-ADM-01)' })
  findAll(@Query() filter: AdminUserFilterDto) {
    return this.adminUsersService.findAll(filter);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.TELECOM)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.findOne(id);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve an owner/tenant account (FR-ADM-02)' })
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.approve(user, id);
  }

  @Patch(':id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.adminUsersService.reject(user, id, dto.reason);
  }

  @Patch(':id/suspend')
  @ApiOperation({ summary: 'Suspend an account and revoke its sessions (FR-ADM-02)' })
  suspend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendUserDto) {
    return this.adminUsersService.suspend(user, id, dto);
  }

  @Patch(':id/unsuspend')
  unsuspend(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.unsuspend(user, id);
  }

  @Patch(':id/kyc')
  @ApiOperation({ summary: 'Verify / reject tenant identity information' })
  decideKyc(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: KycDecisionDto) {
    return this.adminUsersService.decideKyc(user, id, dto);
  }
}
