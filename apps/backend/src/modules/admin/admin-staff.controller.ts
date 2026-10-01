import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { buildPaginatedList, resolvePagination } from '../../common/utils/paginated-list.util';
import type { AuthUser } from '../../common/types/auth-user.type';
import {
  CreateManagerForOwnerDto,
  UpdateManagerPermissionsDto,
} from '../core-services/users/dto/create-account.dto';
import { TeamService } from '../core-services/users/services/team.service';
import { AdminStaffFilterDto } from './dto/admin.dto';

/**
 * Platform staff management. Kept separate from the owner-side `/managers`
 * routes, which stay owner-scoped, because these are not tied to one portfolio:
 * the target owner is named on each write and every change is audited with the
 * platform account as the actor, so it shows up in that owner's activity trail.
 */
@ApiTags('Admin - Staff')
@ApiBearerAuth('access-token')
@Controller('admin/managers')
@Roles(UserRole.ADMIN)
export class AdminStaffController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  @ApiOperation({ summary: 'Every staff account on the platform, with the owner each works for' })
  async listStaff(@Query() filter: AdminStaffFilterDto) {
    const { page, limit, skip, take } = resolvePagination(filter.page, filter.limit);
    const result = await this.teamService.listAllManagers({ ...filter, skip, take });
    return buildPaginatedList(result.docs, { page, limit, total: result.total });
  }

  @Post()
  @ApiOperation({ summary: 'Add a staff account to an owner on the owner\'s behalf' })
  createStaff(@CurrentUser() user: AuthUser, @Body() dto: CreateManagerForOwnerDto) {
    const { ownerId, ...rest } = dto;
    return this.teamService.createManager(user, rest, ownerId);
  }

  @Patch(':id/permissions')
  @ApiOperation({ summary: 'Replace the capability grants of any staff account' })
  setStaffPermissions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagerPermissionsDto,
  ) {
    return this.teamService.setManagerPermissions(user, id, dto.permissions);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a staff account and end its sessions' })
  deactivateStaff(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teamService.setManagerActive(user, id, false);
  }

  @Patch(':id/activate')
  @ApiOperation({ summary: 'Restore a deactivated staff account' })
  activateStaff(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teamService.setManagerActive(user, id, true);
  }
}
