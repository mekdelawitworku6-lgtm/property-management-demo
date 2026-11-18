import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { AuditRead } from '../../../common/decorators/audit-read.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { DepositRefundsService } from './deposit-refunds.service';
import {
  CreateDepositRefundDto,
  DecideDepositRefundDto,
  DepositRefundFilterDto,
  PayDepositRefundDto,
} from './dto/inspection.dto';

@ApiTags('Deposit Refunds')
@ApiBearerAuth('access-token')
@Controller('deposit-refunds')
@Roles(UserRole.OWNER, UserRole.MANAGER)
export class DepositRefundsController {
  constructor(private readonly depositRefundsService: DepositRefundsService) {}

  @Post()
  @RequirePermissions(ManagerPermission.AGREEMENT_MANAGE)
  @ApiOperation({ summary: 'Prepare a security-deposit refund with documented deductions' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDepositRefundDto) {
    return this.depositRefundsService.create(user, dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN)
  @RequirePermissions(ManagerPermission.PAYMENT_VIEW)
  @AuditRead('DepositRefund')
  findAll(@CurrentUser() user: AuthUser, @Query() filter: DepositRefundFilterDto) {
    return this.depositRefundsService.findAll(user, filter);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN)
  @RequirePermissions(ManagerPermission.PAYMENT_VIEW)
  @AuditRead('DepositRefund')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.depositRefundsService.findOne(user, id);
  }

  @Post(':id/approve')
  @RequirePermissions(ManagerPermission.AGREEMENT_MANAGE)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideDepositRefundDto,
  ) {
    return this.depositRefundsService.approve(user, id, dto);
  }

  @Post(':id/pay')
  @RequirePermissions(ManagerPermission.PAYMENT_RECORD)
  @ApiOperation({ summary: 'Mark an approved refund as paid' })
  pay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayDepositRefundDto,
  ) {
    return this.depositRefundsService.pay(user, id, dto);
  }

  @Post(':id/reject')
  @RequirePermissions(ManagerPermission.AGREEMENT_MANAGE)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideDepositRefundDto,
  ) {
    return this.depositRefundsService.reject(user, id, dto);
  }
}
