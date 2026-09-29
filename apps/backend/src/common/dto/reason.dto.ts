import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReasonDto {
  @ApiPropertyOptional({ example: 'Fraudulent listing reported' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
