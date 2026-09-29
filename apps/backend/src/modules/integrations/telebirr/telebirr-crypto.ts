import * as crypto from 'crypto';

/**
 * Pure crypto helpers for Telebirr (no Nest/DB deps — unit-testable standalone).
 *
 * Signature scheme: RSA-SHA256 over the JSON string of `biz_content`.
 * PSS vs PKCS#1 padding depends on the merchant docs — CONFIRM FROM DOCS.
 */
export class TelebirrCrypto {
  private readonly privateKeyPem: string | undefined;
  private readonly publicKeyPem: string | undefined;

  constructor(privateKeyPem?: string, publicKeyPem?: string) {
    this.privateKeyPem = privateKeyPem;
    this.publicKeyPem = publicKeyPem;
  }

  get isConfigured(): boolean {
    return Boolean(this.privateKeyPem && this.publicKeyPem);
  }

  /**
   * Deterministically serializes biz_content so both sides sign the same bytes.
   * Field order matters only if Telebirr signs the raw string — keep insertion
   * order and no extra whitespace.
   */
  buildBizContent(fields: Record<string, string | number | undefined>): string {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && value !== '') {
        clean[key] = String(value);
      }
    }
    return JSON.stringify(clean);
  }

  /** Signs a string with our merchant RSA private key (SHA256, PKCS#1 v1.5). */
  signPayload(payload: string): string {
    if (!this.privateKeyPem) {
      throw new Error('TELEBIRR_PRIVATE_KEY is not configured');
    }
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(payload, 'utf8');
    return signer.sign(this.privateKeyPem, 'base64');
  }

  /** Verifies a base64 RSA-SHA256 signature against Telebirr's public key. */
  verifySignature(payload: string, signature: string): boolean {
    if (!this.publicKeyPem) {
      throw new Error('TELEBIRR_PUBLIC_KEY is not configured');
    }
    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(payload, 'utf8');
      return verifier.verify(this.publicKeyPem, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  }
}
