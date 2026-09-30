import { ManagerPermission } from '@prisma/client';

/** Every grant an owner can hand to a staff account. */
export const ALL_MANAGER_PERMISSIONS = Object.values(ManagerPermission);

/** Human labels + short help text, rendered by the owner "add staff" UI. */
export const MANAGER_PERMISSION_LABELS: Record<ManagerPermission, { label: string; description: string }> = {
  PROPERTY_VIEW: { label: 'View properties', description: 'See the property portfolio and unit occupancy.' },
  PROPERTY_MANAGE: { label: 'Add & edit properties', description: 'Register properties and change property details.' },
  UNIT_MANAGE: { label: 'Manage units', description: 'Add units and update unit status, rent or deposit.' },
  TENANT_VIEW: { label: 'View tenants', description: 'See tenants, their agreements and balances.' },
  TENANT_MANAGE: { label: 'Register tenants', description: 'Create tenant accounts and update their profile.' },
  AGREEMENT_VIEW: { label: 'View agreements', description: 'Read rental agreements and lease terms.' },
  AGREEMENT_MANAGE: { label: 'Manage agreements', description: 'Create, renew, terminate and cancel agreements.' },
  COMPLAINT_VIEW: { label: 'View complaints', description: 'Read complaints and reply threads.' },
  COMPLAINT_MANAGE: { label: 'Handle complaints', description: 'Change complaint status, assign vendors and escalate.' },
  PAYMENT_VIEW: { label: 'View payments', description: 'Read invoices, payments and the ledger.' },
  PAYMENT_RECORD: { label: 'Record payments', description: 'Log cash/bank payments and confirm or reject them.' },
  VENDOR_VIEW: { label: 'View vendors', description: 'See the vendor directory.' },
  VENDOR_MANAGE: { label: 'Manage vendors', description: 'Add, edit and remove vendors.' },
  REPORT_VIEW: { label: 'View reports', description: 'Download financial and occupancy reports.' },
};

/** Grants a brand-new staff account when the owner does not tick anything specific. */
export const DEFAULT_MANAGER_PERMISSIONS: ManagerPermission[] = ALL_MANAGER_PERMISSIONS;
