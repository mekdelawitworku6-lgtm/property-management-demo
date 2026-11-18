import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { AuditRead } from '../../../common/decorators/audit-read.decorator';
import { VerifyFaydaDto } from '../../integrations/fayda/dto/verify-fayda.dto';
import { ResponseMessage } from '../../../common/decorators/response-message.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { AgreementsService } from './agreements.service';
import {
  AddDocumentDto, AgreementFilterDto, CreateAgreementDto, RenewAgreementDto, SignAgreementDto, TerminateAgreementDto,
} from './dto/agreement.dto';

@ApiTags('Agreements')
@ApiBearerAuth('access-token')
@Controller('agreements')
export class AgreementsController {
  constructor(private readonly agreementsService: AgreementsService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.AGREEMENT_MANAGE)
  @ApiOperation({ summary: 'Create a lease directly for an existing tenant' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAgreementDto) {
    return this.agreementsService.createDirect(user, dto);
  }

  @Get()
  @RequirePermissions(ManagerPermission.AGREEMENT_VIEW)
  @AuditRead('Agreement')
  @ApiOperation({ summary: 'Tenant: my leases · Owner: portfolio agreements · Admin: all (FR-ADM-01)' })
  findAll(@CurrentUser() user: AuthUser, @Query() filter: AgreementFilterDto) {
    return this.agreementsService.findAll(user, filter);
  }

  @Public()
  @Get('verify/:referenceNo')
  @ApiOperation({ summary: 'Public integrity check of a signed agreement by reference number' })
  verify(@Param('referenceNo') referenceNo: string) {
    return this.agreementsService.verifyByReference(referenceNo);
  }

  @Get('upcoming-renewals')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.AGREEMENT_VIEW)
  @ApiOperation({ summary: 'Leases ending soon, for the renewal prompt (no rent change implied)' })
  upcomingRenewals(@CurrentUser() user: AuthUser) {
    return this.agreementsService.findUpcomingRenewals(user);
  }

  @Get(':id')
  @RequirePermissions(ManagerPermission.AGREEMENT_VIEW)
  @AuditRead('Agreement')
  @ApiOperation({ summary: 'Full agreement text + integrity check' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agreementsService.findOne(user, id);
  }

  @Post(':id/fayda/verify')
  @Roles(UserRole.TENANT)
  @ResponseMessage('Fayda verification completed')
  @ApiOperation({ summary: 'Tenant completes a mock Fayda check for this agreement' })
  verifyFayda(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyFaydaDto,
  ) {
    return this.agreementsService.verifyFayda(user, id, dto);
  }

  @Post(':id/sign')
  @Roles(UserRole.TENANT)
  @ResponseMessage('Agreement signed')
  @ApiOperation({ summary: 'Tenant signs the agreement digitally (FR-TEN-03)' })
  sign(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SignAgreementDto) {
    return this.agreementsService.sign(user, id, dto);
  }

  @Post(':id/renew')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @RequirePermissions(ManagerPermission.AGREEMENT_MANAGE)
  @ApiOperation({ summary: 'Offer a renewal (new agreement for the tenant to sign)' })
  renew(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenewAgreementDto) {
    return this.agreementsService.renew(user, id, dto);
  }

  @Post(':id/terminate')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN)
  @RequirePermissions(ManagerPermission.AGREEMENT_MANAGE)
  terminate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TerminateAgreementDto) {
    return this.agreementsService.terminate(user, id, dto);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.TENANT)
  @RequirePermissions(ManagerPermission.AGREEMENT_MANAGE)
  @ApiOperation({ summary: 'Withdraw / decline an unsigned agreement' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agreementsService.cancel(user, id);
  }

  @Post(':id/documents')
  @Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.TENANT)
  addDocument(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddDocumentDto) {
    return this.agreementsService.addDocument(user, id, dto);
  }
}
