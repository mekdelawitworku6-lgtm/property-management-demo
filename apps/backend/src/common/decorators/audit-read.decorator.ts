import { SetMetadata } from '@nestjs/common';

export const AUDIT_READ_KEY = 'auditReadEntityType';

/**
 * Marks a read endpoint as auditable, so the owner can see who opened which record.
 *
 * Applied deliberately to business records only: the notification poll, auth and
 * sync routes are intentionally left unannotated so they do not flood the log.
 */
export const AuditRead = (entityType: string) => SetMetadata(AUDIT_READ_KEY, entityType);
