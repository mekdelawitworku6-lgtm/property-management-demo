import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { AgreementStatus, Language } from '@prisma/client';

export const REPORT_FORMATS = ['json', 'xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export class ReportFormatDto {
  @ApiPropertyOptional({ enum: REPORT_FORMATS, default: 'json' }) @IsOptional() @IsIn(REPORT_FORMATS) format?: ReportFormat;
  @ApiPropertyOptional({ enum: Language, description: 'Defaults to the user language preference' })
  @IsOptional() @IsEnum(Language) lang?: Language;
  @ApiPropertyOptional({ description: 'Admin: owner to report on' }) @IsOptional() @IsUUID() ownerId?: string;
}

export class StatementQueryDto extends ReportFormatDto {
  @ApiPropertyOptional({ example: '2026-09', description: 'Defaults to the current month' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' })
  month?: string;
}

export class RangeQueryDto extends ReportFormatDto {
  @ApiPropertyOptional({ example: '2026-09-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-09-30' }) @IsOptional() @IsDateString() to?: string;
}

export class AgreementReportQueryDto extends ReportFormatDto {
  @ApiPropertyOptional({ enum: AgreementStatus }) @IsOptional() @IsEnum(AgreementStatus) status?: AgreementStatus;
}

export class AuditReportQueryDto extends ReportFormatDto {
  @ApiPropertyOptional({ example: 'Payment' }) @IsOptional() @IsString() entityType?: string;
}
