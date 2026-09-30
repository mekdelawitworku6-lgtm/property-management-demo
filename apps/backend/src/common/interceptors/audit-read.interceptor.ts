import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mergeMap } from 'rxjs';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../constants/audit-actions.constants';
import { AUDIT_READ_KEY } from '../decorators/audit-read.decorator';
import type { AuthUser } from '../types/auth-user.type';

/**
 * Writes a `RECORD_VIEWED` entry for every GET route annotated with `@AuditRead`,
 * which is how an owner sees which staff member opened which record.
 *
 * The write is awaited on purpose: "who looked at what" is only trustworthy if the
 * entry is already queryable by the time the response is returned, otherwise the
 * activity page would race its own audit trail. `AuditService.log` swallows its own
 * errors, so this can never fail the request.
 */
@Injectable()
export class AuditReadInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest();
    if (request.method !== 'GET') return next.handle();

    const entityType = this.reflector.getAllAndOverride<string>(AUDIT_READ_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!entityType) return next.handle();

    return next.handle().pipe(
      mergeMap(async (value) => {
        const user = request.user as AuthUser | undefined;
        if (user?.id) {
          await this.audit.log(
            AUDIT_ACTIONS.RECORD_VIEWED,
            entityType,
            typeof request.params?.id === 'string' ? request.params.id : null,
            user,
            { path: request.originalUrl ?? request.url },
          );
        }
        return value;
      }),
    );
  }
}
