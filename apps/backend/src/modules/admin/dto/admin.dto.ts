import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApprovalStatus, KycStatus, UserRole } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class AdminUserFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: [UserRole.OWNER, UserRole.TENANT, UserRole.MANAGER, UserRole.ADMIN, UserRole.TELECOM] })
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @ApiPropertyOptional({ enum: ApprovalStatus }) @IsOptional() @IsEnum(ApprovalStatus) approvalStatus?: ApprovalStatus;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isSuspended?: boolean;
  @ApiPropertyOptional({ description: 'Name, phone or email' }) @IsOptional() @IsString() search?: string;
}

export class SuspendUserDto {
  @ApiProperty({ example: 'Fraudulent listings reported by tenants' }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class KycDecisionDto {
  @ApiProperty({ enum: [KycStatus.VERIFIED, KycStatus.REJECTED] })
  @IsIn([KycStatus.VERIFIED, KycStatus.REJECTED])
  status: KycStatus;
}
