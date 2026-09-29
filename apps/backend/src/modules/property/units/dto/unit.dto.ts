import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { UnitStatus, UnitType } from '@prisma/client';

export class CreateUnitDto {
  @ApiProperty({ example: 'A-101' }) @IsString() @MaxLength(30) unitNumber: string;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @Type(() => Number) @IsInt() floor?: number;
  @ApiProperty({ enum: UnitType }) @IsEnum(UnitType) type: UnitType;
  @ApiPropertyOptional({ example: 2 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) bedrooms?: number;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) bathrooms?: number;
  @ApiPropertyOptional({ example: 85 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) sizeSqm?: number;
  @ApiProperty({ example: 15000, description: 'Monthly rent (ETB)' }) @Type(() => Number) @IsNumber() @Min(1) rentAmount: number;
  @ApiPropertyOptional({ example: 30000 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) depositAmount?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isListed?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) amenities?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) photos?: string[];
  @ApiPropertyOptional({ description: 'Rental terms shown to applicants' }) @IsOptional() @IsString() terms?: string;
}

export class UpdateUnitDto extends PartialType(OmitType(CreateUnitDto, [] as const)) {
  @ApiPropertyOptional({ enum: [UnitStatus.VACANT, UnitStatus.UNDER_MAINTENANCE], description: 'Manual status change' })
  @IsOptional()
  @IsEnum(UnitStatus)
  status?: UnitStatus;
}
