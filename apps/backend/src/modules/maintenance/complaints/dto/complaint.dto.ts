import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ComplaintCategory, ComplaintStatus, EscalationStatus, Priority } from '@prisma/client';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

export class CreateComplaintDto {
  @ApiPropertyOptional({ description: 'Tenant: defaults to the active agreement' }) @IsOptional() @IsUUID() agreementId?: string;
  @ApiPropertyOptional({ description: 'Owner/manager raising a request: target property' }) @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() unitId?: string;
  @ApiProperty({ enum: ComplaintCategory }) @IsEnum(ComplaintCategory) category: ComplaintCategory;
  @ApiPropertyOptional({ enum: Priority, default: Priority.MEDIUM }) @IsOptional() @IsEnum(Priority) priority?: Priority;
  @ApiProperty({ example: 'Kitchen sink leaking' }) @IsString() @MinLength(3) @MaxLength(200) title: string;
  @ApiProperty({ example: 'Water leaks under the sink since yesterday.' }) @IsString() @MinLength(3) description: string;
  @ApiPropertyOptional({ type: [String], description: 'Photo URLs from /files/upload/complaints' })
  @IsOptional() @IsArray() @IsString({ each: true }) photos?: string[];
  @ApiPropertyOptional({ description: 'Idempotency key for offline-queued submissions' })
  @IsOptional() @IsString() @MaxLength(100) clientRef?: string;
}

export class UpdateComplaintStatusDto {
  @ApiProperty({ enum: ComplaintStatus }) @IsEnum(ComplaintStatus) status: ComplaintStatus;
  @ApiPropertyOptional({ description: 'Optional note added to the thread' }) @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class RespondComplaintDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) message: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) attachments?: string[];
}

export class EscalateComplaintDto {
  @ApiProperty({ example: 'Owner not responding for two weeks' }) @IsString() @MinLength(3) @MaxLength(1000) reason: string;
}

export class AdminResolveComplaintDto {
  @ApiProperty({ example: 'Owner agreed to repair within 5 days; deposit untouched.' })
  @IsString() @MinLength(3) @MaxLength(2000) resolution: string;
  @ApiPropertyOptional({ enum: [ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED], default: ComplaintStatus.RESOLVED })
  @IsOptional() @IsIn([ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED]) status?: ComplaintStatus;
}

export class ComplaintFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ComplaintStatus }) @IsOptional() @IsEnum(ComplaintStatus) status?: ComplaintStatus;
  @ApiPropertyOptional({ enum: ComplaintCategory }) @IsOptional() @IsEnum(ComplaintCategory) category?: ComplaintCategory;
  @ApiPropertyOptional({ enum: Priority }) @IsOptional() @IsEnum(Priority) priority?: Priority;
  @ApiPropertyOptional({ enum: EscalationStatus }) @IsOptional() @IsEnum(EscalationStatus) escalationStatus?: EscalationStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() propertyId?: string;
  @ApiPropertyOptional({ description: 'Admin: only stale unresolved complaints' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  staleOnly?: boolean;
}
