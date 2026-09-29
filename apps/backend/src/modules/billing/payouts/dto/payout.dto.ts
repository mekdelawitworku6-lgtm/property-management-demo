import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaymentMethod, PayoutStatus } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

export class PayoutPeriodDto {
  @ApiProperty({ example: '2026-09-01' }) @IsDateString() from: string;
  @ApiProperty({ example: '2026-09-30' }) @IsDateString() to: string;
}

export class GeneratePayoutDto extends PayoutPeriodDto {
  @ApiProperty() @IsUUID() ownerId: string;
}

export class PreviewPayoutDto extends PayoutPeriodDto {
  @ApiPropertyOptional({ description: 'Staff only; owners preview their own payout' }) @IsOptional() @IsUUID() ownerId?: string;
}

export class MarkPayoutPaidDto {
  @ApiProperty({ enum: [PaymentMethod.TELEBIRR, PaymentMethod.BANK_TRANSFER] })
  @IsIn([PaymentMethod.TELEBIRR, PaymentMethod.BANK_TRANSFER])
  method: PaymentMethod;
  @ApiProperty({ example: 'FT26280XYZ' }) @IsString() @MaxLength(100) paidReference: string;
}

export class PayoutFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: PayoutStatus }) @IsOptional() @IsEnum(PayoutStatus) status?: PayoutStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
}
