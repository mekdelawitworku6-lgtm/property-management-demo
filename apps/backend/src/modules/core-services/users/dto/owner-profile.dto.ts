import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class UpdateOwnerProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) companyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) tinNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional({ enum: [PaymentMethod.TELEBIRR, PaymentMethod.BANK_TRANSFER] })
  @IsOptional()
  @IsEnum(PaymentMethod)
  payoutMethod?: PaymentMethod;
  @ApiPropertyOptional({ example: 'Commercial Bank of Ethiopia' }) @IsOptional() @IsString() @MaxLength(100) bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) bankAccount?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) telebirrNumber?: string;
}
