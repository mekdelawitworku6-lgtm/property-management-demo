/** Real-time sync events pushed over Socket.IO so all three clients stay consistent. */
export const REALTIME_EVENTS = {
  NOTIFICATION: 'notification',
  RENTAL_REQUEST_UPDATED: 'rental-request.updated',
  AGREEMENT_UPDATED: 'agreement.updated',
  KYC_UPDATED: 'kyc.updated',
  INVOICE_UPDATED: 'invoice.updated',
  PAYMENT_UPDATED: 'payment.updated',
  COMPLAINT_UPDATED: 'complaint.updated',
  WORK_ORDER_UPDATED: 'work-order.updated',
  INSPECTION_UPDATED: 'inspection.updated',
  DEPOSIT_REFUND_UPDATED: 'deposit-refund.updated',
  UNIT_UPDATED: 'unit.updated',
} as const;

export type RealtimeEvent = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];
