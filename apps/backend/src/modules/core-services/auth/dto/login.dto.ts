import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: '0911223344', description: 'Phone number or email' })
  @IsString()
  identifier: string;

  @ApiProperty({ example: 'Secret123' })
  @IsString()
  @MinLength(1)
  password: string;
}
