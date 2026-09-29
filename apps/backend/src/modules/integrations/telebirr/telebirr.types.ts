/**
 * Wire shapes for the Telebirr merchant API.
 *
 * The developer-portal H5 product and the USSD/CPS product differ in format;
 * every field that depends on the owner's exact docs is annotated with
 * "CONFIRM FROM DOCS" so it can be corrected in one place.
 */

export type TelebirrPaymentMode = 'ussd' | 'h5' | 'mock';

export type TelebirrPaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface TelebirrOrderParams {
  /** Our unique reference, e.g. PAY-20260929-7F3K9Q */
  orderReference: string;
  /** ETB amount, decimal string when sent to Telebirr */
  amount: number;
  /** Short human title shown on the payment prompt */
  title: string;
  /** Ethio Telecom phone for USSD push (09XXXXXXXX or 2519XXXXXXXX) */
  phone?: string;
  /** Public webhook URL Telebirr calls on completion */
  notifyUrl: string;
  /** Public URL the browser returns to after H5 payment */
  redirectUrl?: string;
}

export interface TelebirrOrderResult {
  paymentUrl: string | null;
  mode: TelebirrPaymentMode;
  ussd?: {
    code: string;
    phone: string;
    expiresInMinutes: number;
  };
}

export interface TelebirrTokenResponse {
  token: string;
  expiresIn?: number;
}

export interface TelebirrPreorderResponse {
  prepayId: string;
  payUrl?: string;
}

/** Parsed webhook — both H5 JSON envelope and USSD SOAP XML normalize to this. */
export interface TelebirrCallback {
  orderReference: string;
  transId: string | null;
  amount: number | null;
  resultCode: string;
  resultMsg?: string;
  success: boolean;
  raw: string;
}

export interface TelebirrQueryResult {
  status: TelebirrPaymentStatus;
  transId?: string;
  amount?: number;
}
