import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { Priority, WorkOrderStatus } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

export class CreateWorkOrderDto {
  @ApiPropertyOptional({ description: 'Derived from the complaint when complaintId is given' }) @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() unitId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() complaintId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;
  @ApiProperty({ example: 'Replace kitchen sink pipe' }) @IsString() @MinLength(3) @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ enum: Priority }) @IsOptional() @IsEnum(Priority) priority?: Priority;
  @ApiPropertyOptional({ example: 1200 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) estimatedCost?: number;
  @ApiPropertyOptional({ example: '2026-10-02' }) @IsOptional() @IsDateString() scheduledDate?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) photos?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) clientRef?: string;
}

export class UpdateWorkOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;
  @ApiPropertyOptional({ enum: [WorkOrderStatus.OPEN, WorkOrderStatus.ASSIGNED, WorkOrderStatus.IN_PROGRESS] })
  @IsOptional()
  @IsIn([WorkOrderStatus.OPEN, WorkOrderStatus.ASSIGNED, WorkOrderStatus.IN_PROGRESS])
  status?: WorkOrderStatus;
  @ApiPropertyOptional({ enum: Priority }) @IsOptional() @IsEnum(Priority) priority?: Priority;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) estimatedCost?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) photos?: string[];
}

export class CompleteWorkOrderDto {
  @ApiProperty({ example: 1350, description: 'Actual cost — logged as a maintenance expense' })
  @Type(() => Number) @IsNumber() @Min(0) actualCost: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) completionNotes?: string;
  @ApiPropertyOptional({ type: [String], description: 'After photos' }) @IsOptional() @IsArray() @IsString({ each: true }) photos?: string[];
}

export class WorkOrderFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: WorkOrderStatus }) @IsOptional() @IsEnum(WorkOrderStatus) status?: WorkOrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() vendorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() complaintId?: string;
}
