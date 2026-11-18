import { Controller, Get, Param, ParseUUIDPipe, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { AuditRead } from '../../../common/decorators/audit-read.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { ExportedFile, ReportsService } from './reports.service';
import { AgreementReportQueryDto, AuditReportQueryDto, RangeQueryDto, ReportFormatDto, StatementQueryDto } from './dto/report.dto';

export function toStreamable(res: Response, file: ExportedFile): StreamableFile {
  res.set({
    'Content-Type': file.contentType,
    'Content-Disposition': `attachment; filename="${file.fileName}"`,
  });
  return new StreamableFile(file.buffer);
}

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Controller('reports')
@Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN, UserRole.TELECOM)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('owner-statement')
  @RequirePermissions(ManagerPermission.REPORT_VIEW)
  @AuditRead('Report')
  @ApiProduces('application/json', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Monthly owner statement (income, expenses, net) — json / xlsx / pdf, AM / EN' })
  async ownerStatement(
    @CurrentUser() user: AuthUser,
    @Query() query: StatementQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!query.format || query.format === 'json') {
      return this.reportsService.ownerStatement(user, query.month, query.ownerId);
    }
    const file = await this.reportsService.exportOwnerStatement(
      user, query.month, query.format, query.lang ?? user.language, query.ownerId,
    );
    return toStreamable(res, file);
  }

  @Get('payments')
  @RequirePermissions(ManagerPermission.REPORT_VIEW)
  @ApiOperation({ summary: 'Payments report for a date range — json / xlsx / pdf' })
  async payments(@CurrentUser() user: AuthUser, @Query() query: RangeQueryDto, @Res({ passthrough: true }) res: Response) {
    if (!query.format || query.format === 'json') {
      return this.reportsService.paymentsReport(user, query.from, query.to, query.ownerId);
    }
    const file = await this.reportsService.exportPayments(
      user, query.from, query.to, query.format, query.lang ?? user.language, query.ownerId,
    );
    return toStreamable(res, file);
  }

  @Get('rent-roll')
  @RequirePermissions(ManagerPermission.REPORT_VIEW)
  @ApiOperation({ summary: 'Rent roll: occupied units, tenants, rent, outstanding — json / xlsx / pdf' })
  async rentRoll(@CurrentUser() user: AuthUser, @Query() query: StatementQueryDto, @Res({ passthrough: true }) res: Response) {
    if (!query.format || query.format === 'json') return this.reportsService.rentRoll(user, query.ownerId);
    const file = await this.reportsService.exportRentRoll(user, query.format, query.lang ?? user.language, query.ownerId);
    return toStreamable(res, file);
  }

  @Get('agreements')
  @RequirePermissions(ManagerPermission.REPORT_VIEW)
  @AuditRead('Agreement')
  @ApiProduces('application/json', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Agreement audit registry — json / xlsx / pdf' })
  async agreements(
    @CurrentUser() user: AuthUser,
    @Query() query: AgreementReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!query.format || query.format === 'json') return this.reportsService.agreementsReport(user, query.status);
    const file = await this.reportsService.exportAgreements(
      user, query.status, query.format, query.lang ?? user.language,
    );
    return toStreamable(res, file);
  }

  @Get('audit-logs')
  @Roles(UserRole.ADMIN, UserRole.TELECOM)
  @AuditRead('AuditLog')
  @ApiProduces('application/json', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Certified platform audit trail — json / xlsx / pdf (platform staff only)' })
  async auditLogs(
    @CurrentUser() user: AuthUser,
    @Query() query: AuditReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!query.format || query.format === 'json') return this.reportsService.auditLogsReport(user, query.entityType);
    const file = await this.reportsService.exportAuditLogs(
      user, query.entityType, query.format, query.lang ?? user.language,
    );
    return toStreamable(res, file);
  }

  @Get('agreement/:id')
  @ApiProduces('application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Signed agreement certificate — xlsx / pdf' })
  async agreementCertificate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ReportFormatDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const format = query.format && query.format !== 'json' ? query.format : 'pdf';
    const file = await this.reportsService.exportAgreementCertificate(user, id, format, query.lang ?? user.language);
    return toStreamable(res, file);
  }
}
