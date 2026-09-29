import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { AgreementStatus } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

/** Owner-adjustable lease terms (used when accepting a request or creating directly). */
export class LeaseTermsDto {
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional({ example: 12 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) durationMonths?: number;
  @ApiPropertyOptional({ example: 15000 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) rentAmount?: number;
  @ApiPropertyOptional({ example: 30000 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) depositAmount?: number;
  @ApiPropertyOptional({ example: 5, description: 'Day of month rent is due (1–28)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(28) paymentDueDay?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) specialTerms?: string;
}

export class CreateAgreementDto extends LeaseTermsDto {
  @ApiProperty() @IsUUID() unitId: string;
  @ApiProperty({ description: 'Existing tenant account (see POST /tenants)' }) @IsUUID() tenantId: string;
  @ApiProperty({ example: '2026-10-01' }) @IsDateString() declare startDate: string;
  @ApiProperty({ example: 12 }) @Type(() => Number) @IsInt() @Min(1) @Max(120) declare durationMonths: number;
}

export class SignAgreementDto {
  @ApiProperty({ example: 'Meron Tadesse', description: 'Typed full name as the digital signature' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  signatureName: string;

  @ApiProperty({ description: 'contentHash of the agreement text the tenant reviewed' })
  @IsString()
  @Length(64, 64)
  contentHash: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the agreement terms' })
  acceptTerms: boolean;
}

export class RenewAgreementDto {
  @ApiProperty({ example: 12 }) @Type(() => Number) @IsInt() @Min(1) @Max(120) durationMonths: number;
  @ApiPropertyOptional({ example: 16500 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(1) rentAmount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) depositAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) specialTerms?: string;
}

export class TerminateAgreementDto {
  @ApiProperty({ example: 'Tenant relocating' }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
  @ApiPropertyOptional({ example: '2026-12-31', description: 'Defaults to today' }) @IsOptional() @IsDateString() effectiveDate?: string;
}

export class AddDocumentDto {
  @ApiProperty({ description: 'URL from /files/upload/agreements' }) @IsString() @MaxLength(500) url: string;
}

export class AgreementFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AgreementStatus }) @IsOptional() @IsEnum(AgreementStatus) status?: AgreementStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() unitId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tenantId?: string;
  @ApiPropertyOptional({ description: 'Admin: filter by owner' }) @IsOptional() @IsUUID() ownerId?: string;
}
