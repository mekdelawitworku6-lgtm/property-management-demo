import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyFaydaDto {
  @ApiProperty({ example: 'FAYDA-12345678', description: 'Mock Fayda digital ID' })
  @IsString()
  @Matches(/^[A-Za-z0-9-]{6,40}$/)
  @MaxLength(40)
  faydaId: string;

  @ApiPropertyOptional({ example: 'Meron Tesfaye' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({ example: '1998-04-12' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
}
