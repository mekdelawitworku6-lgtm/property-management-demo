import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuditLogsController, OwnerAuditLogsController } from './audit-logs.controller';
import { AuditReadInterceptor } from '../interceptors/audit-read.interceptor';

@Global()
@Module({
  controllers: [AuditLogsController, OwnerAuditLogsController],
  providers: [
    AuditService,
    // Registered here (not in main.ts) so read auditing also runs in the e2e suites.
    { provide: APP_INTERCEPTOR, useClass: AuditReadInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
