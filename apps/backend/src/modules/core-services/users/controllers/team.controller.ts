import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Roles } from '../../../../common/decorators/roles.decorator';
import type { AuthUser } from '../../../../common/types/auth-user.type';
import { TeamService } from '../services/team.service';
import { CreateManagerDto, CreateTenantDto } from '../dto/create-account.dto';

@ApiTags('Owner - Managers & Tenants')
@ApiBearerAuth('access-token')
@Controller()
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post('managers')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'Add a property manager to my account' })
  createManager(@CurrentUser() user: AuthUser, @Body() dto: CreateManagerDto) {
    return this.teamService.createManager(user, dto);
  }

  @Get('managers')
  @Roles(UserRole.OWNER)
  @ApiOperation({ summary: 'List my managers' })
  listManagers(@CurrentUser() user: AuthUser) {
    return this.teamService.listManagers(user);
  }

  @Patch('managers/:id/deactivate')
  @Roles(UserRole.OWNER)
  deactivateManager(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teamService.setManagerActive(user, id, false);
  }

  @Patch('managers/:id/activate')
  @Roles(UserRole.OWNER)
  activateManager(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teamService.setManagerActive(user, id, true);
  }

  @Post('tenants')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Register a tenant (contact, ID, emergency contacts)' })
  createTenant(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantDto) {
    return this.teamService.createTenant(user, dto);
  }

  @Get('tenants/lookup')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiQuery({ name: 'phone', example: '0911223344' })
  @ApiOperation({ summary: 'Find a tenant account by phone number' })
  lookupTenant(@Query('phone') phone: string) {
    return this.teamService.findTenantByPhone(phone);
  }

  @Get('tenants')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiQuery({ name: 'search', required: false })
  @ApiOperation({ summary: 'Tenants in my portfolio with outstanding balances' })
  listTenants(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.teamService.listPortfolioTenants(user, search);
  }

  @Get('tenants/:id')
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @ApiOperation({ summary: 'Tenant detail: agreements, invoices, payment history' })
  getTenant(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teamService.getPortfolioTenant(user, id);
  }
}
