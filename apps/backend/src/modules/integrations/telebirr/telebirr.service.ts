import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TelebirrCrypto } from './telebirr-crypto';
import { parseTelebirrCallback } from './telebirr-callback.parser';
import {
  TelebirrOrderParams,
  TelebirrOrderResult,
  TelebirrPreorderResponse,
  TelebirrQueryResult,
  TelebirrTokenResponse,
} from './telebirr.types';

const DEFAULT_TIMEOUT_MS = 15 * 1000;
const DEFAULT_EXPIRES_MINUTES = 5;
const TOKEN_TTL_MS = 25 * 60 * 1000; // Telebirr tokens last 30 min; refresh at 25.

/**
 * Telebirr merchant integration (Ethio Telecom payment layer, FR-TEN-04 / FR-ADM-05).
 * Ported from BMDelivery's TelebirrService.
 *
 * With TELEBIRR_MOCK=true (default) no network I/O happens — the service returns a
 * mock checkout so the whole platform runs without credentials. Fields marked
 * "CONFIRM FROM DOCS" depend on the merchant's Telebirr developer-portal docs.
 */
@Injectable()
export class TelebirrService {
  private readonly logger = new Logger(TelebirrService.name);
  private readonly crypto: TelebirrCrypto;

  private cachedToken: string | null = null;
  private cachedTokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {
    this.crypto = new TelebirrCrypto(
      this.configService.get<string>('TELEBIRR_PRIVATE_KEY') || undefined,
      this.configService.get<string>('TELEBIRR_PUBLIC_KEY') || undefined,
    );
  }

  isMock(): boolean {
    return this.configService.get<string>('TELEBIRR_MOCK', 'true') !== 'false';
  }

  get configured(): boolean {
    return Boolean(
      this.configService.get<string>('TELEBIRR_APP_ID') &&
        this.configService.get<string>('TELEBIRR_APP_KEY') &&
        this.configService.get<string>('TELEBIRR_APP_SECRET') &&
        this.configService.get<string>('TELEBIRR_MERCH_CODE') &&
        this.configService.get<string>('TELEBIRR_API_BASE_URL'),
    );
  }

  /** Creates a payment order: H5 checkout URL and/or USSD push to the phone. */
  async createPaymentOrder(params: TelebirrOrderParams): Promise<TelebirrOrderResult> {
    if (this.isMock()) return this.createMockOrder(params);
    if (!this.configured) {
      throw new BadRequestException(
        'Telebirr is not configured (set TELEBIRR_MOCK=true or provide TELEBIRR_* env vars)',
      );
    }
    try {
      const token = await this.getToken();
      const prepayId = await this.preOrder(token, params);
      const paymentUrl = this.buildH5CheckoutUrl(prepayId);
      if (params.phone) {
        return {
          paymentUrl,
          mode: 'ussd',
          ussd: {
            code: this.ussdDialCode(),
            phone: this.normalizePhone(params.phone),
            expiresInMinutes: DEFAULT_EXPIRES_MINUTES,
          },
        };
      }
      return { paymentUrl, mode: 'h5' };
    } catch (error) {
      this.logger.error(`Telebirr createPaymentOrder failed: ${(error as Error).message}`);
      throw new BadRequestException(`Telebirr payment initiation failed: ${(error as Error).message}`);
    }
  }

  /**
   * Verifies a webhook body. H5 envelopes are RSA-signed and MUST verify.
   * USSD SOAP callbacks carry no client signature (CPS authenticates the push).
   * Unsigned legacy/mock bodies are only accepted in mock mode.
   */
  verifyCallback(rawBody: Buffer | string): { ok: boolean; reason?: string } {
    const raw = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const parsed = parseTelebirrCallback(raw);

    if (!parsed.callback) return { ok: false, reason: 'Unrecognized webhook body format' };
    if (parsed.format === 'legacy') {
      return this.isMock() ? { ok: true } : { ok: false, reason: 'Unsigned webhook rejected in live mode' };
    }
    if (parsed.format === 'ussd') return { ok: true };
    if (!parsed.signature || !parsed.signedPayload) {
      return { ok: false, reason: 'H5 webhook missing sign or biz_content' };
    }
    if (this.isMock() && !this.crypto.isConfigured) return { ok: true };
    if (!this.crypto.verifySignature(parsed.signedPayload, parsed.signature)) {
      return { ok: false, reason: 'RSA signature verification failed' };
    }
    return { ok: true };
  }

  /** Parses any webhook body into a normalized callback (no verification). */
  parseCallback(rawBody: Buffer | string) {
    const raw = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    return parseTelebirrCallback(raw);
  }

  /** Queries Telebirr for the current state of an order (reconciliation). */
  async queryOrder(orderReference: string): Promise<TelebirrQueryResult> {
    if (this.isMock()) return { status: 'pending' };

    const token = await this.getToken();
    // CONFIRM FROM DOCS: queryorder endpoint + payload.
    const bizContent = this.crypto.buildBizContent({
      appid: this.configService.get<string>('TELEBIRR_APP_ID'),
      merch_code: this.configService.get<string>('TELEBIRR_MERCH_CODE'),
      merch_order_id: orderReference,
      out_trade_no: orderReference,
    });
    const { data } = await axios.post(
      `${this.apiBaseUrl()}/payment/v1/merchant/queryorder`,
      {
        appid: this.configService.get<string>('TELEBIRR_APP_ID'),
        biz_content: bizContent,
        sign: this.crypto.signPayload(bizContent),
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: DEFAULT_TIMEOUT_MS },
    );
    const resultCode = String(data?.data?.resultCode ?? data?.resultCode ?? 'unknown');
    return {
      status: resultCode === '0' ? 'completed' : resultCode === 'failed' ? 'failed' : 'pending',
      transId: data?.data?.transId,
      amount: data?.data?.totalAmount !== undefined ? parseFloat(data.data.totalAmount) : undefined,
    };
  }

  // ─── Live internals ────────────────────────────────────────────────────────

  private apiBaseUrl(): string {
    return this.configService.get<string>('TELEBIRR_API_BASE_URL', '');
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedTokenExpiresAt) return this.cachedToken;
    // CONFIRM FROM DOCS: token endpoint body.
    const { data } = await axios.post<TelebirrTokenResponse>(
      `${this.apiBaseUrl()}/payment/v1/token`,
      {
        appId: this.configService.get<string>('TELEBIRR_APP_ID'),
        appKey: this.configService.get<string>('TELEBIRR_APP_KEY'),
        appSecret: this.configService.get<string>('TELEBIRR_APP_SECRET'),
        timestamp: String(Math.floor(Date.now() / 1000)),
      },
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    if (!data?.token) throw new Error('Telebirr token response missing token');
    this.cachedToken = data.token;
    this.cachedTokenExpiresAt = Date.now() + TOKEN_TTL_MS;
    return data.token;
  }

  private async preOrder(token: string, params: TelebirrOrderParams): Promise<string> {
    const bizContent = this.crypto.buildBizContent({
      appid: this.configService.get<string>('TELEBIRR_APP_ID'),
      merch_code: this.configService.get<string>('TELEBIRR_MERCH_CODE'),
      merch_order_id: params.orderReference,
      trade_type: 'Checkout',
      title: params.title,
      total_amount: params.amount.toFixed(2),
      trans_currency: 'ETB',
      timeout_express: DEFAULT_EXPIRES_MINUTES.toString(),
      notify_url: params.notifyUrl,
      redirect_url: params.redirectUrl,
    });
    const { data } = await axios.post<{ code: number; msg: string; data?: TelebirrPreorderResponse }>(
      `${this.apiBaseUrl()}/payment/v1/merchant/preOrder`,
      {
        appid: this.configService.get<string>('TELEBIRR_APP_ID'),
        biz_content: bizContent,
        sign: this.crypto.signPayload(bizContent),
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: DEFAULT_TIMEOUT_MS },
    );
    if (data?.code !== 0 || !data?.data?.prepayId) {
      throw new Error(`Telebirr preOrder failed (${data?.code}): ${data?.msg}`);
    }
    return data.data.prepayId;
  }

  private buildH5CheckoutUrl(prepayId: string): string {
    const webBase = this.configService.get<string>('TELEBIRR_WEB_BASE_URL', '');
    if (!webBase) throw new Error('TELEBIRR_WEB_BASE_URL is not configured');
    const query = this.crypto.buildBizContent({
      appid: this.configService.get<string>('TELEBIRR_APP_ID'),
      merch_code: this.configService.get<string>('TELEBIRR_MERCH_CODE'),
      nonce_str: `${Date.now()}${Math.random().toString(36).slice(2, 10)}`,
      prepay_id: prepayId,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });
    return `${webBase}?${query}&sign=${encodeURIComponent(this.crypto.signPayload(query))}`;
  }

  private ussdDialCode(): string {
    return `*847*${this.configService.get<string>('TELEBIRR_SHORT_CODE', '')}#`;
  }

  normalizePhone(phone: string): string {
    const digits = String(phone ?? '').replace(/[^\d]/g, '');
    return digits.startsWith('251') ? `0${digits.slice(3)}` : digits;
  }

  // ─── Mock mode ─────────────────────────────────────────────────────────────

  private createMockOrder(params: TelebirrOrderParams): TelebirrOrderResult {
    const baseUrl = this.configService.get<string>('BASE_URL', 'http://localhost:4100');
    return {
      paymentUrl: `${baseUrl}/api/v1/payments/telebirr/mock-checkout/${params.orderReference}`,
      mode: 'mock',
      ussd: {
        code: `*847*${this.configService.get<string>('TELEBIRR_SHORT_CODE') || '000000'}#`,
        phone: this.normalizePhone(params.phone ?? '0900000000'),
        expiresInMinutes: DEFAULT_EXPIRES_MINUTES,
      },
    };
  }
}
