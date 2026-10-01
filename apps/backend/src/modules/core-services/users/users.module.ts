import { Module } from '@nestjs/common';
import { ProfileController } from './controllers/profile.controller';
import { TeamController } from './controllers/team.controller';
import { ProfileService } from './services/profile.service';
import { TeamService } from './services/team.service';

@Module({
  controllers: [ProfileController, TeamController],
  providers: [ProfileService, TeamService],
  exports: [ProfileService, TeamService],
})
export class UsersModule {}
