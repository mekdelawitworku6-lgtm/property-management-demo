import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Length, MinLength } from 'class-validator';
import { OtpPurpose } from '@prisma/client';

export class SendOtpDto {
  @ApiProperty({ example: '0911223344' })
  @IsString()
  phoneNumber: string;

  @ApiProperty({ enum: OtpPurpose, example: OtpPurpose.VERIFY_PHONE })
  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;
}

export class VerifyPhoneDto {
  @ApiProperty({ example: '0911223344' })
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: '0911223344' })
  @IsString()
  phoneNumber: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: '0911223344' })
  @IsString()
  phoneNumber: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  code: string;

  @ApiProperty({ example: 'NewSecret123' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword: string;

  @ApiProperty({ example: 'NewSecret123' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
