import { TelebirrCallback } from './telebirr.types';

export type TelebirrCallbackFormat = 'h5' | 'ussd' | 'legacy' | 'unknown';

export interface ParsedTelebirrCallback {
  format: TelebirrCallbackFormat;
  callback: TelebirrCallback | null;
  /** For H5 envelopes: the exact string Telebirr signed (biz_content). */
  signedPayload?: string;
  /** For H5 envelopes: the base64 signature to verify. */
  signature?: string;
  /** For USSD SOAP: the transaction-id key Telebirr uses (no signature to check). */
  xmlRaw?: string;
}

const SOAP_TAG = (tag: string) => new RegExp(`<res:${tag}>([^<]*)</res:${tag}>`);

/**
 * Normalizes Telebirr webhook bodies (H5 signed JSON envelope, USSD SOAP XML,
 * and the legacy mock JSON) into one shape. The controller/service then only
 * deals with TelebirrCallback.
 */
export function parseTelebirrCallback(rawBody: string | Buffer): ParsedTelebirrCallback {
  const raw = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const trimmed = raw.trim();

  if (!trimmed) {
    return { format: 'unknown', callback: null };
  }

  // ─── USSD / CPS SOAP XML ───────────────────────────────────────────────────
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<soap') || trimmed.includes('<res:OriginatorConversationID>')) {
    const orderReference =
      SOAP_TAG('OriginatorConversationID').exec(trimmed)?.[1] ?? null;
    const transId = SOAP_TAG('TransactionID').exec(trimmed)?.[1] ?? null;
    const resultCode = SOAP_TAG('ResultCode').exec(trimmed)?.[1] ?? 'unknown';
    const resultDesc = SOAP_TAG('ResultDesc').exec(trimmed)?.[1];

    if (!orderReference) {
      return { format: 'unknown', callback: null, xmlRaw: trimmed };
    }

    return {
      format: 'ussd',
      xmlRaw: trimmed,
      callback: {
        orderReference,
        transId,
        amount: null,
        resultCode,
        resultMsg: resultDesc,
        success: resultCode === '0',
        raw: trimmed,
      },
    };
  }

  // ─── H5 signed JSON envelope ───────────────────────────────────────────────
  try {
    const envelope = JSON.parse(trimmed) as Record<string, unknown>;
    const bizContentRaw = typeof envelope.biz_content === 'string' ? envelope.biz_content : null;
    if (bizContentRaw && typeof envelope.sign === 'string') {
      const biz = JSON.parse(bizContentRaw) as Record<string, unknown>;
      const orderReference =
        String(biz.outTradeNo ?? biz.merch_order_id ?? '');
      const resultCode = String(biz.resultCode ?? biz.ResultCode ?? 'unknown');
      const amount = biz.totalAmount !== undefined && biz.totalAmount !== null
        ? parseFloat(String(biz.totalAmount))
        : null;

      return {
        format: 'h5',
        signedPayload: bizContentRaw,
        signature: envelope.sign as string,
        callback: {
          orderReference,
          transId: biz.transId ? String(biz.transId) : null,
          amount: Number.isFinite(amount) ? amount : null,
          resultCode,
          resultMsg: biz.resultMsg ? String(biz.resultMsg) : undefined,
          success: resultCode === '0',
          raw: trimmed,
        },
      };
    }

    // ─── Legacy mock JSON body (no signature) ────────────────────────────────
    const legacyRef = String(envelope.merch_order_id ?? envelope.out_trade_no ?? '');
    if (legacyRef) {
      const amount = envelope.amount !== undefined && envelope.amount !== null
        ? parseFloat(String(envelope.amount))
        : null;
      return {
        format: 'legacy',
        callback: {
          orderReference: legacyRef,
          transId: envelope.transId ? String(envelope.transId) : envelope.transactionId ? String(envelope.transactionId) : null,
          amount: Number.isFinite(amount) ? amount : null,
          resultCode: '0',
          resultMsg: 'success',
          success: true,
          raw: trimmed,
        },
      };
    }
  } catch {
    return { format: 'unknown', callback: null };
  }

  return { format: 'unknown', callback: null };
}
