import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Language, UserRole } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ enum: [UserRole.OWNER, UserRole.TENANT], example: UserRole.TENANT })
  @IsIn([UserRole.OWNER, UserRole.TENANT], { message: 'role must be OWNER or TENANT' })
  role: UserRole;

  @ApiProperty({ example: 'Abebe Kebede' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  fullName: string;

  @ApiProperty({ example: '0911223344', description: 'Ethiopian mobile number' })
  @IsString()
  phoneNumber: string;

  @ApiPropertyOptional({ example: 'abebe@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Secret123', description: 'Min 8 chars incl. a letter and a digit' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ enum: Language, default: Language.EN })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ example: 'Bole Real Estate PLC', description: 'Owners only' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  companyName?: string;
}
