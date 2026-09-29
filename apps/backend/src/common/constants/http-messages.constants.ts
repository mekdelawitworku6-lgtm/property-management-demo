export const HTTP_MESSAGES = {
  CREATED: 'Created successfully',
  UPDATED: 'Updated successfully',
  DELETED: 'Deleted successfully',
  RETRIEVED: 'Retrieved successfully',
  NOT_FOUND: (entity: string) => `${entity} not found`,
  FORBIDDEN: 'You do not have access to this resource',
} as const;
