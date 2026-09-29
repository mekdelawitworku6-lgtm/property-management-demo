import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { SyncService } from './sync.service';

@ApiTags('Offline Sync')
@ApiBearerAuth('access-token')
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get()
  @ApiQuery({ name: 'since', required: false, example: '2026-09-29T08:00:00.000Z' })
  @ApiOperation({ summary: 'Delta sync for offline-capable clients (records changed since a timestamp)' })
  changes(@CurrentUser() user: AuthUser, @Query('since') since?: string) {
    return this.syncService.changes(user, since);
  }
}
