import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { RentalRequestStatus } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

export class CreateRentalRequestDto {
  @ApiProperty() @IsUUID() unitId: string;
  @ApiProperty({ example: '2026-10-01' }) @IsDateString() desiredStartDate: string;
  @ApiProperty({ example: 12 }) @Type(() => Number) @IsInt() @Min(1) @Max(120) durationMonths: number;
  @ApiPropertyOptional({ example: 'I work nearby and can move in immediately.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class RejectRentalRequestDto {
  @ApiPropertyOptional({ example: 'Unit reserved for family' }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class RentalRequestFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: RentalRequestStatus }) @IsOptional() @IsEnum(RentalRequestStatus) status?: RentalRequestStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() unitId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
}
