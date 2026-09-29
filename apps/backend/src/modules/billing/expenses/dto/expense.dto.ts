import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { ExpenseCategory } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

export class CreateExpenseDto {
  @ApiProperty() @IsUUID() propertyId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() unitId?: string;
  @ApiProperty({ enum: ExpenseCategory }) @IsEnum(ExpenseCategory) category: ExpenseCategory;
  @ApiProperty({ example: 2500 }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ example: '2026-09-15' }) @IsDateString() incurredOn: string;
}

export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}

export class ExpenseFilterDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional({ enum: ExpenseCategory }) @IsOptional() @IsEnum(ExpenseCategory) category?: ExpenseCategory;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}
