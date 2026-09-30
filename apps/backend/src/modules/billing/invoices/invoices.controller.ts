import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { AuditRead } from '../../../common/decorators/audit-read.decorator';
import { ReasonDto } from '../../../common/dto/reason.dto';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { InvoicesService } from './invoices.service';
import { CreateManualInvoiceDto, InvoiceFilterDto } from './dto/invoice.dto';

@ApiTags('Invoices')
@ApiBearerAuth('access-token')
@Controller()
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get('invoices')
  @RequirePermissions(ManagerPermission.PAYMENT_VIEW)
  @AuditRead('Invoice')
  @ApiOperation({ summary: 'List invoices (tenant: mine, owner: portfolio, staff: all)' })
  findAll(@CurrentUser() user: AuthUser, @Query() filter: InvoiceFilterDto) {
    return this.invoicesService.findAll(user, filter);
  }

  @Get('invoices/balances')
  @RequirePermissions(ManagerPermission.PAYMENT_VIEW)
  @ApiOperation({ summary: 'Outstanding balance per tenant' })
  balances(@CurrentUser() user: AuthUser) {
    return this.invoicesService.getBalances(user);
  }

  @Get('invoices/:id')
  @RequirePermissions(ManagerPermission.PAYMENT_VIEW)
  @AuditRead('Invoice')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.findOne(user, id);
  }

  @Post('invoices')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.PAYMENT_RECORD)
  @ApiOperation({ summary: 'Add a penalty / other charge to an active agreement' })
  createManual(@CurrentUser() user: AuthUser, @Body() dto: CreateManualInvoiceDto) {
    return this.invoicesService.createManual(user, dto);
  }

  @Patch('invoices/:id/cancel')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.PAYMENT_RECORD)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.invoicesService.cancel(user, id, dto.reason);
  }

  @Get('agreements/:id/schedule')
  @ApiOperation({ summary: 'Payment schedule for an agreement (projected + issued invoices)' })
  schedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.getSchedule(user, id);
  }
}
