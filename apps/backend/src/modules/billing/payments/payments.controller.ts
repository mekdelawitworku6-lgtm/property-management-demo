import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { PaymentsService } from './payments.service';
import {
  ConfirmPaymentDto, InitiateTelebirrDto, PaymentFilterDto, RecordOfflinePaymentDto, RejectPaymentDto, SubmitBankTransferDto,
} from './dto/payment.dto';

@ApiTags('Payments')
@ApiBearerAuth('access-token')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('telebirr')
  @Roles(UserRole.TENANT)
  @ApiOperation({ summary: 'Pay rent with Telebirr (FR-TEN-04)' })
  initiateTelebirr(@CurrentUser() user: AuthUser, @Body() dto: InitiateTelebirrDto) {
    return this.paymentsService.initiateTelebirr(user, dto);
  }

  @Post('bank-transfer')
  @Roles(UserRole.TENANT)
  @ApiOperation({ summary: 'Submit a bank-transfer reference for confirmation (FR-TEN-04)' })
  submitBankTransfer(@CurrentUser() user: AuthUser, @Body() dto: SubmitBankTransferDto) {
    return this.paymentsService.submitBankTransfer(user, dto);
  }

  @Post('offline')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Log a cash payment / directly received bank transfer' })
  recordOffline(@CurrentUser() user: AuthUser, @Body() dto: RecordOfflinePaymentDto) {
    return this.paymentsService.recordOffline(user, dto);
  }

  @Public()
  @SkipThrottle()
  @Post('telebirr/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Telebirr / Ethio Telecom payment confirmation callback (FR-ADM-05)' })
  telebirrWebhook(@Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    return this.paymentsService.handleTelebirrWebhook(raw);
  }

  @Public()
  @Get('telebirr/mock-checkout/:referenceNo')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'application/json')
  mockCheckout(@Param('referenceNo') referenceNo: string) {
    return this.paymentsService.completeMockCheckout(referenceNo);
  }

  @Get()
  @ApiOperation({ summary: 'Payment history (tenant / owner / platform-wide)' })
  findAll(@CurrentUser() user: AuthUser, @Query() filter: PaymentFilterDto) {
    return this.paymentsService.findAll(user, filter);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.findOne(user, id);
  }

  @Patch(':id/confirm')
  @Roles(UserRole.TELECOM, UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Confirm a pending payment (Ethio Telecom / admin; owner for bank transfers)' })
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmPaymentDto) {
    return this.paymentsService.confirm(user, id, dto);
  }

  @Patch(':id/reject')
  @Roles(UserRole.TELECOM, UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectPaymentDto) {
    return this.paymentsService.reject(user, id, dto);
  }

  @Post(':id/reconcile')
  @Roles(UserRole.TELECOM, UserRole.ADMIN)
  @ApiOperation({ summary: 'Query Telebirr for the real status of a pending payment' })
  reconcile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.reconcileTelebirr(user, id);
  }
}
