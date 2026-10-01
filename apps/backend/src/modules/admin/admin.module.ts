import { Module } from '@nestjs/common';
import { UsersModule } from '../core-services/users/users.module';
import { AdminStaffController } from './admin-staff.controller';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [UsersModule],
  controllers: [AdminController, AdminStaffController],
  providers: [AdminUsersService],
  exports: [AdminUsersService],
})
export class AdminModule {}
