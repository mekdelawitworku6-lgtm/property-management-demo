import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { InvoiceStatus, InvoiceType } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

export class InvoiceFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: InvoiceStatus }) @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;
  @ApiPropertyOptional({ enum: InvoiceType }) @IsOptional() @IsEnum(InvoiceType) type?: InvoiceType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tenantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() agreementId?: string;
  @ApiPropertyOptional({ description: 'Due date from' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ description: 'Due date to' }) @IsOptional() @IsDateString() to?: string;
}

export class CreateManualInvoiceDto {
  @ApiProperty() @IsUUID() agreementId: string;
  @ApiProperty({ enum: [InvoiceType.PENALTY, InvoiceType.OTHER] })
  @IsIn([InvoiceType.PENALTY, InvoiceType.OTHER])
  type: InvoiceType;
  @ApiProperty({ example: 500 }) @Type(() => Number) @IsNumber() @Min(1) amount: number;
  @ApiProperty({ example: '2026-10-05' }) @IsDateString() dueDate: string;
  @ApiProperty({ example: 'Late payment penalty' }) @IsString() @MaxLength(300) description: string;
}
