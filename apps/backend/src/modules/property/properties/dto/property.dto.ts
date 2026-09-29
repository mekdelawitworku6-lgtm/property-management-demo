import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength,
} from 'class-validator';
import { PropertyType } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

export class CreatePropertyDto {
  @ApiProperty({ example: 'Bole Heights Apartments' }) @IsString() @MinLength(2) @MaxLength(150) name: string;
  @ApiProperty({ enum: PropertyType }) @IsEnum(PropertyType) type: PropertyType;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ example: 'Addis Ababa' }) @IsString() @MaxLength(80) city: string;
  @ApiPropertyOptional({ example: 'Bole' }) @IsOptional() @IsString() @MaxLength(80) subCity?: string;
  @ApiPropertyOptional({ example: '03' }) @IsOptional() @IsString() @MaxLength(40) woreda?: string;
  @ApiProperty({ example: 'Near Edna Mall, Bole Road' }) @IsString() address: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @ApiPropertyOptional({ description: 'Total area (m²)' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) totalArea?: number;
  @ApiPropertyOptional({ example: 'LEASEHOLD' }) @IsOptional() @IsString() @MaxLength(60) ownershipType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) titleDeedNo?: string;
  @ApiPropertyOptional({ type: [String], example: ['Parking', 'Elevator', 'Generator', 'Water tank'] })
  @IsOptional() @IsArray() @IsString({ each: true }) amenities?: string[];
  @ApiPropertyOptional({ type: [String], description: 'URLs from /files/upload/properties' })
  @IsOptional() @IsArray() @IsString({ each: true }) photos?: string[];
}

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {}

export class PropertyFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: PropertyType }) @IsOptional() @IsEnum(PropertyType) type?: PropertyType;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ description: 'Admin: filter by owner' }) @IsOptional() @IsString() ownerId?: string;
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}
