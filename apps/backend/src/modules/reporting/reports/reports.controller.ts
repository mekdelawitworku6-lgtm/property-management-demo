import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ManagerPermission, UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { AuditRead } from '../../../common/decorators/audit-read.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { ExportedFile, ReportsService } from './reports.service';
import { RangeQueryDto, StatementQueryDto } from './dto/report.dto';

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
}
