import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './common/audit/audit.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

// Core services
import { AuthModule } from './modules/core-services/auth/auth.module';
import { UsersModule } from './modules/core-services/users/users.module';
import { NotificationsModule } from './modules/core-services/notifications/notifications.module';
import { RealtimeModule } from './modules/core-services/realtime/realtime.module';
import { FilesModule } from './modules/core-services/files/files.module';
import { HealthModule } from './modules/core-services/health/health.module';
import { SyncModule } from './modules/core-services/sync/sync.module';
import { SchedulerModule } from './modules/core-services/scheduler/scheduler.module';

// Domain modules
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { PropertyModule } from './modules/property/property.module';
import { LeasingModule } from './modules/leasing/leasing.module';
import { BillingModule } from './modules/billing/billing.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true },
      envFilePath: ['.env', '.env.local'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),

    DatabaseModule,
    AuditModule,
    IntegrationsModule,
    RealtimeModule,
    NotificationsModule,

    AuthModule,
    UsersModule,
    FilesModule,
    HealthModule,
    SyncModule,

    PropertyModule,
    LeasingModule,
    BillingModule,
    MaintenanceModule,
    ReportingModule,
    AdminModule,
    SchedulerModule,
  ],
  providers: [
    // Order matters: throttle → authenticate → authorize by role.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
