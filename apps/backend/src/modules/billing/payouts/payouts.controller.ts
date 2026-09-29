import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { PayoutsService } from './payouts.service';
import { GeneratePayoutDto, MarkPayoutPaidDto, PayoutFilterDto, PreviewPayoutDto } from './dto/payout.dto';

@ApiTags('Payouts')
@ApiBearerAuth('access-token')
@Controller('payouts')
@Roles(UserRole.OWNER, UserRole.MANAGER, UserRole.ADMIN, UserRole.TELECOM)
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Get('preview')
  @ApiOperation({ summary: 'Owner payout calculation for a period (gross, platform fee, net)' })
  preview(@CurrentUser() user: AuthUser, @Query() dto: PreviewPayoutDto) {
    return this.payoutsService.preview(user, dto);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.TELECOM)
  @ApiOperation({ summary: 'Generate a payout for an owner and period' })
  generate(@CurrentUser() user: AuthUser, @Body() dto: GeneratePayoutDto) {
    return this.payoutsService.generate(user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() filter: PayoutFilterDto) {
    return this.payoutsService.findAll(user, filter);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payoutsService.findOne(user, id);
  }

  @Patch(':id/paid')
  @Roles(UserRole.ADMIN, UserRole.TELECOM)
  @ApiOperation({ summary: 'Record the disbursement to the owner' })
  markPaid(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkPayoutPaidDto) {
    return this.payoutsService.markPaid(user, id, dto);
  }
}
