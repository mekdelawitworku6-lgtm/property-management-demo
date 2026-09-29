import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const ID_TYPES = ['KEBELE_ID', 'PASSPORT', 'FAYDA', 'DRIVING_LICENSE'] as const;

export class UpdateTenantProfileDto {
  @ApiPropertyOptional({ enum: ID_TYPES }) @IsOptional() @IsIn(ID_TYPES) idType?: string;
  @ApiPropertyOptional({ description: 'Stored encrypted at rest' }) @IsOptional() @IsString() @MaxLength(60) idNumber?: string;
  @ApiPropertyOptional({ description: 'Fayda digital ID (future verification)' }) @IsOptional() @IsString() @MaxLength(40) faydaId?: string;
  @ApiPropertyOptional({ example: '1995-04-12' }) @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) occupation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) emergencyContactPhone?: string;
  @ApiPropertyOptional({ example: 'Sister' }) @IsOptional() @IsString() @MaxLength(50) emergencyContactRelation?: string;
}
