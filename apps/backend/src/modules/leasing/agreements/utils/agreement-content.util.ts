import { addDays, addMonths, formatDate } from '../../../../common/utils/date.util';
import { toNumber } from '../../../../common/utils/money.util';
import { sha256 } from '../../../../common/utils/crypto.util';

export interface AgreementContentInput {
  referenceNo: string;
  owner: { fullName: string; phoneNumber: string };
  tenant: { fullName: string; phoneNumber: string };
  property: { name: string; address: string; city: string; subCity?: string | null };
  unit: { unitNumber: string; type: string };
  startDate: Date;
  endDate: Date;
  rentAmount: unknown;
  depositAmount: unknown;
  currency?: string;
  paymentDueDay: number;
  specialTerms?: string | null;
  unitTerms?: string | null;
}

/** Inclusive end date: a 12-month lease starting 2026-10-01 ends 2027-09-30. */
export function computeEndDate(startDate: Date, durationMonths: number): Date {
  return addDays(addMonths(startDate, durationMonths), -1);
}

/** Generates the bilingual (English / Amharic) rental agreement text. */
export function buildAgreementContent(input: AgreementContentInput): string {
  const currency = input.currency ?? 'ETB';
  const rent = toNumber(input.rentAmount).toFixed(2);
  const deposit = toNumber(input.depositAmount).toFixed(2);
  const location = [input.property.address, input.property.subCity, input.property.city].filter(Boolean).join(', ');
  const lines = [
    `RESIDENTIAL / COMMERCIAL RENTAL AGREEMENT — የኪራይ ውል`,
    `Reference / ማጣቀሻ: ${input.referenceNo}`,
    ``,
    `1. PARTIES / ተዋዋዮች`,
    `   Landlord / አከራይ: ${input.owner.fullName} (${input.owner.phoneNumber})`,
    `   Tenant / ተከራይ: ${input.tenant.fullName} (${input.tenant.phoneNumber})`,
    ``,
    `2. PREMISES / የሚከራየው ቦታ`,
    `   ${input.property.name}, Unit ${input.unit.unitNumber} (${input.unit.type}) — ${location}`,
    ``,
    `3. TERM / የውል ጊዜ`,
    `   From ${formatDate(input.startDate)} to ${formatDate(input.endDate)} (inclusive).`,
    `   ከ${formatDate(input.startDate)} እስከ ${formatDate(input.endDate)} ድረስ።`,
    ``,
    `4. RENT / ኪራይ`,
    `   Monthly rent: ${rent} ${currency}, due on day ${input.paymentDueDay} of each month.`,
    `   ወርሃዊ ኪራይ፦ ${rent} ብር፣ በየወሩ በ${input.paymentDueDay}ኛው ቀን ይከፈላል።`,
    `   Partial months are prorated by days. Payment via Telebirr, bank transfer or cash (receipted).`,
    ``,
    `5. DEPOSIT / ቅድመ ክፍያ ዋስትና`,
    `   Security deposit: ${deposit} ${currency}, refundable at the end of the term less documented damages.`,
    ``,
    `6. MAINTENANCE / ጥገና`,
    `   The tenant reports maintenance issues through the platform; the landlord responds in a reasonable time.`,
    ``,
    `7. TERMINATION / ውል ማቋረጥ`,
    `   Either party may terminate per applicable Ethiopian law. Early termination is recorded on the platform.`,
  ];
  if (input.unitTerms) lines.push('', '8. UNIT TERMS / የክፍሉ ልዩ ሁኔታዎች', `   ${input.unitTerms}`);
  if (input.specialTerms) lines.push('', '9. SPECIAL TERMS / ልዩ ስምምነቶች', `   ${input.specialTerms}`);
  lines.push(
    '',
    'By signing digitally, both parties agree to the terms above. This record is immutable once signed.',
    'በዲጂታል በመፈረም ሁለቱም ወገኖች ከላይ በተገለጹት ሁኔታዎች ተስማምተዋል። ከተፈረመ በኋላ ይህ መዝገብ አይቀየርም።',
  );
  return lines.join('\n');
}

export function hashContent(content: string): string {
  return sha256(content);
}

/** Binds the tenant's signature to the exact agreement text, signer and time. */
export function computeSignatureHash(contentHash: string, tenantId: string, signedAt: Date, signatureName: string): string {
  return sha256(`${contentHash}|${tenantId}|${signedAt.toISOString()}|${signatureName}`);
}

/** Verifies that the stored text and signature were not altered after signing. */
export function verifyAgreementIntegrity(agreement: {
  content: string;
  contentHash: string;
  tenantId: string;
  tenantSignedAt?: Date | null;
  tenantSignature?: string | null;
  signatureHash?: string | null;
}): { contentValid: boolean; signatureValid: boolean | null } {
  const contentValid = hashContent(agreement.content) === agreement.contentHash;
  if (!agreement.tenantSignedAt || !agreement.signatureHash) return { contentValid, signatureValid: null };
  const expected = computeSignatureHash(
    agreement.contentHash,
    agreement.tenantId,
    new Date(agreement.tenantSignedAt),
    agreement.tenantSignature ?? '',
  );
  return { contentValid, signatureValid: expected === agreement.signatureHash };
}
