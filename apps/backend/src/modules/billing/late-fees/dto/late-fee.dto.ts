import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { InvoiceType, LateFeeFrequency, LateFeeType } from '@prisma/client';

export class CreateLateFeeRuleDto {
  @ApiProperty({ example: '5% after grace period' }) @IsString() @MinLength(3) @MaxLength(120) label: string;

  @ApiPropertyOptional({
    description: 'Set to scope the rule to one agreement; omit for a portfolio-wide default',
  })
  @IsOptional() @IsUUID() agreementId?: string;

  @ApiPropertyOptional({ enum: LateFeeType, example: LateFeeType.PERCENT, description: 'Defaults to PERCENT' })
  @IsOptional() @IsEnum(LateFeeType) type?: LateFeeType;

  @ApiProperty({ example: 5, description: 'Percent of the unpaid balance, or a flat ETB amount' })
  @Type(() => Number) @IsNumber() @Min(0.01) @Max(1_000_000) value: number;

  @ApiPropertyOptional({ example: 5, description: 'Days after the due date before any fee applies' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(90) gracePeriodDays?: number;

  @ApiPropertyOptional({ enum: LateFeeFrequency, example: LateFeeFrequency.PER_MONTH })
  @IsOptional() @IsEnum(LateFeeFrequency) frequency?: LateFeeFrequency;

  @ApiPropertyOptional({
    example: 50,
    description: 'Total fee ceiling as a percent of the unpaid balance; omit for no ceiling',
  })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) @Max(100) maxPercentOfBalance?: number;

  @ApiPropertyOptional({ enum: InvoiceType, isArray: true, example: [InvoiceType.RENT] })
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsEnum(InvoiceType, { each: true }) appliesTo?: InvoiceType[];

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateLateFeeRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(120) label?: string;
  @ApiPropertyOptional({ enum: LateFeeType }) @IsOptional() @IsEnum(LateFeeType) type?: LateFeeType;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) @Max(1_000_000) value?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(90) gracePeriodDays?: number;
  @ApiPropertyOptional({ enum: LateFeeFrequency }) @IsOptional() @IsEnum(LateFeeFrequency) frequency?: LateFeeFrequency;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) @Max(100) maxPercentOfBalance?: number;
  @ApiPropertyOptional({ enum: InvoiceType, isArray: true }) @IsOptional() @IsArray() @IsEnum(InvoiceType, { each: true }) appliesTo?: InvoiceType[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class LateFeeRuleFilterDto {
  @ApiPropertyOptional({ description: 'Admin-only: inspect another owner rules' })
  @IsOptional() @IsUUID() ownerId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() agreementId?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;
}
