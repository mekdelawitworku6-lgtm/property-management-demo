import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

class BasePaymentDto {
  @ApiProperty() @IsUUID() invoiceId: string;
  @ApiPropertyOptional({ example: 15000, description: 'Defaults to the outstanding balance' })
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) amount?: number;
  @ApiPropertyOptional({ description: 'Idempotency key for offline-queued submissions' })
  @IsOptional() @IsString() @MaxLength(100) clientRef?: string;
}

export class InitiateTelebirrDto extends BasePaymentDto {
  @ApiPropertyOptional({ example: '0911223344', description: 'Telebirr wallet phone for USSD push' })
  @IsOptional() @IsString() phone?: string;
}

export class SubmitBankTransferDto extends BasePaymentDto {
  @ApiProperty({ example: 'Commercial Bank of Ethiopia' }) @IsString() @MaxLength(100) bankName: string;
  @ApiProperty({ example: 'FT26272ABC12', description: 'Bank transaction reference' }) @IsString() @MaxLength(100) providerReference: string;
  @ApiPropertyOptional({ description: 'Receipt image URL from /files/upload/receipts' }) @IsOptional() @IsString() receiptUrl?: string;
}

export class RecordOfflinePaymentDto extends BasePaymentDto {
  @ApiProperty({ enum: [PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER] })
  @IsIn([PaymentMethod.CASH, PaymentMethod.BANK_TRANSFER])
  method: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) providerReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) bankName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() receiptUrl?: string;
}

export class ConfirmPaymentDto {
  @ApiPropertyOptional({ description: 'Provider / bank reference confirmed by Ethio Telecom or the owner' })
  @IsOptional() @IsString() @MaxLength(100) providerReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class RejectPaymentDto {
  @ApiProperty({ example: 'Bank reference not found' }) @IsString() @MaxLength(500) reason: string;
}

export class PaymentFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: PaymentStatus }) @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tenantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() agreementId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional({ example: '2026-09-01' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ example: '2026-09-30' }) @IsOptional() @IsDateString() to?: string;
}
