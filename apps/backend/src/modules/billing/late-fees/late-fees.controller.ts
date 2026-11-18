import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { LateFeesService } from './late-fees.service';
import { CreateLateFeeRuleDto, LateFeeRuleFilterDto, UpdateLateFeeRuleDto } from './dto/late-fee.dto';

@ApiTags('Late Fees')
@ApiBearerAuth('access-token')
@Controller()
export class LateFeesController {
  constructor(private readonly lateFeesService: LateFeesService) {}

  @Get('late-fee-rules')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.PAYMENT_VIEW)
  @ApiOperation({ summary: 'List late-fee rules (portfolio defaults and per-agreement overrides)' })
  findAll(@CurrentUser() user: AuthUser, @Query() filter: LateFeeRuleFilterDto) {
    return this.lateFeesService.findRules(user, filter);
  }

  @Get('late-fee-rules/preview')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.PAYMENT_VIEW)
  @ApiOperation({ summary: 'What the current rules would bill today, without writing anything' })
  preview(@CurrentUser() user: AuthUser) {
    return this.lateFeesService.preview(user);
  }

  @Post('late-fee-rules')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.PAYMENT_RECORD)
  @ApiOperation({ summary: 'Create a portfolio-default or per-agreement late-fee rule' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLateFeeRuleDto) {
    return this.lateFeesService.createRule(user, dto);
  }

  @Patch('late-fee-rules/:id')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.PAYMENT_RECORD)
  @ApiOperation({ summary: 'Update a late-fee rule' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLateFeeRuleDto) {
    return this.lateFeesService.updateRule(user, id, dto);
  }

  @Delete('late-fee-rules/:id')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.PAYMENT_RECORD)
  @ApiOperation({ summary: 'Deactivate a rule (historic penalties keep their explanation)' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.lateFeesService.removeRule(user, id);
  }
}
