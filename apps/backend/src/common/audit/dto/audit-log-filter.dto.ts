import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../dto/pagination.dto';

export class AuditLogFilterDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'PAYMENT_CONFIRMED' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ example: 'Payment' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

/** Owner trail: same filters, plus the switch to hide read-only view entries. */
export class OwnerAuditLogFilterDto extends AuditLogFilterDto {
  @ApiPropertyOptional({ description: 'Set false to show only real changes and hide RECORD_VIEWED entries' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'boolean' ? value : value === 'true'))
  @IsBoolean()
  includeViews?: boolean;
}
