import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Roles } from '../../../../common/decorators/roles.decorator';
import type { AuthUser } from '../../../../common/types/auth-user.type';
import { ProfileService } from '../services/profile.service';
import { UpdateMeDto } from '../dto/update-me.dto';
import { UpdateOwnerProfileDto } from '../dto/owner-profile.dto';
import { UpdateTenantProfileDto } from '../dto/tenant-profile.dto';

@ApiTags('Profile')
@ApiBearerAuth('access-token')
@Controller('users/me')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'My profile (ID number is masked)' })
  getProfile(@CurrentUser() user: AuthUser) {
    return this.profileService.getProfile(user);
  }

  @Patch()
  @ApiOperation({ summary: 'Update name, email, language preference (AM/EN), Telegram chat id' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.profileService.updateMe(user, dto);
  }

  @Patch('owner-profile')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Owner company + payout details' })
  updateOwnerProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateOwnerProfileDto) {
    return this.profileService.updateOwnerProfile(user, dto);
  }

  @Patch('tenant-profile')
  @Roles(UserRole.TENANT)
  @ApiOperation({ summary: 'Tenant ID information + emergency contacts (KYC)' })
  updateTenantProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateTenantProfileDto) {
    return this.profileService.updateTenantProfile(user, dto);
  }
}
