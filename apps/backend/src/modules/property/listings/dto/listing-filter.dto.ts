import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PropertyType, UnitType } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

export class ListingFilterDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'Addis Ababa' }) @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ example: 'Bole' }) @IsOptional() @IsString() subCity?: string;
  @ApiPropertyOptional({ enum: PropertyType }) @IsOptional() @IsEnum(PropertyType) propertyType?: PropertyType;
  @ApiPropertyOptional({ enum: UnitType }) @IsOptional() @IsEnum(UnitType) unitType?: UnitType;
  @ApiPropertyOptional({ example: 5000 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minPrice?: number;
  @ApiPropertyOptional({ example: 30000 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxPrice?: number;
  @ApiPropertyOptional({ example: 2 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) minBedrooms?: number;
  @ApiPropertyOptional({ description: 'Free text: property name, address, sub-city' }) @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ enum: ['price_asc', 'price_desc', 'newest'], default: 'newest' })
  @IsOptional()
  @IsIn(['price_asc', 'price_desc', 'newest'])
  sort?: 'price_asc' | 'price_desc' | 'newest';
}
