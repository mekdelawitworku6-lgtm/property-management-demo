import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Language } from '@prisma/client';

export class UpdateMeDto {
  @ApiPropertyOptional({ example: 'Abebe Kebede' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: Language, description: 'Preferred UI / notification language' })
  @IsOptional()
  @IsEnum(Language)
  language?: Language;

  @ApiPropertyOptional({ description: 'Telegram chat id for optional Telegram notifications' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  telegramChatId?: string;
}
