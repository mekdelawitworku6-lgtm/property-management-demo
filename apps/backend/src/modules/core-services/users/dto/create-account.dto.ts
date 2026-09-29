import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Language } from '@prisma/client';
import { UpdateTenantProfileDto } from './tenant-profile.dto';

export class CreateManagerDto {
  @ApiProperty({ example: 'Sara Alemu' }) @IsString() @MinLength(2) @MaxLength(150) fullName: string;
  @ApiProperty({ example: '0922334455' }) @IsString() phoneNumber: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiProperty({ example: 'Manager123' }) @IsString() @MinLength(8) password: string;
  @ApiPropertyOptional({ enum: Language }) @IsOptional() @IsEnum(Language) language?: Language;
}

/** Owner/manager registers a tenant (Section 4.1.2: contact details, ID information, emergency contacts). */
export class CreateTenantDto extends UpdateTenantProfileDto {
  @ApiProperty({ example: 'Meron Tadesse' }) @IsString() @MinLength(2) @MaxLength(150) fullName: string;
  @ApiProperty({ example: '0933445566' }) @IsString() phoneNumber: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ enum: Language }) @IsOptional() @IsEnum(Language) language?: Language;
  @ApiPropertyOptional({ description: 'Initial password; a random one is generated when omitted and the tenant resets via SMS' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
