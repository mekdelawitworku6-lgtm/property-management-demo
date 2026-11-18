import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DepositRefundStatus, InspectionStatus, InspectionType } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

export class InspectionItemDto {
  @ApiProperty({ example: 'Walls and ceiling' }) @IsString() @MaxLength(120) label: string;
  @ApiProperty({ example: true }) @IsBoolean() ok: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CreateInspectionDto {
  @ApiProperty() @IsUUID() agreementId: string;
  @ApiProperty({ enum: InspectionType }) @IsEnum(InspectionType) type: InspectionType;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledAt?: string;
  @ApiPropertyOptional({ type: [InspectionItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionItemDto)
  items?: InspectionItemDto[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) photos?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) clientRef?: string;
}

export class CompleteInspectionDto {
  @ApiPropertyOptional({ type: [InspectionItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionItemDto)
  items?: InspectionItemDto[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) photos?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class InspectionFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: InspectionType }) @IsOptional() @IsEnum(InspectionType) type?: InspectionType;
  @ApiPropertyOptional({ enum: InspectionStatus }) @IsOptional() @IsEnum(InspectionStatus) status?: InspectionStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() agreementId?: string;
}

export class CreateDepositRefundDto {
  @ApiProperty() @IsUUID() agreementId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inspectionId?: string;
  @ApiPropertyOptional({ example: 0 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) deductions?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) clientRef?: string;
}

export class DecideDepositRefundDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class PayDepositRefundDto {
  @ApiPropertyOptional({ example: 'TELEBIRR-ABC123' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  providerReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class DepositRefundFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: DepositRefundStatus })
  @IsOptional()
  @IsEnum(DepositRefundStatus)
  status?: DepositRefundStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() agreementId?: string;
}
