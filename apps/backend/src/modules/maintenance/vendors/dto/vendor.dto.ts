import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { VendorServiceType } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

export class CreateVendorDto {
  @ApiProperty({ example: 'Kebede Plumbing Services' }) @IsString() @MinLength(2) @MaxLength(150) name: string;
  @ApiProperty({ enum: VendorServiceType }) @IsEnum(VendorServiceType) serviceType: VendorServiceType;
  @ApiProperty({ example: '0911556677' }) @IsString() phoneNumber: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateVendorDto extends PartialType(CreateVendorDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class VendorFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: VendorServiceType }) @IsOptional() @IsEnum(VendorServiceType) serviceType?: VendorServiceType;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}
