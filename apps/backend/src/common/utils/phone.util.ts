/**
 * Normalizes Ethiopian phone numbers to E.164 (+2519XXXXXXXX / +2517XXXXXXXX).
 * Accepts 09..., 07..., 9..., 7..., 2519..., +2519...
 */
export function normalizeEthiopianPhone(input: string): string | null {
  if (!input) return null;
  const digits = String(input).replace(/[^\d]/g, '');
  let local: string | null = null;
  if (/^251[79]\d{8}$/.test(digits)) local = digits.slice(3);
  else if (/^0[79]\d{8}$/.test(digits)) local = digits.slice(1);
  else if (/^[79]\d{8}$/.test(digits)) local = digits;
  return local ? `+251${local}` : null;
}

export function isValidEthiopianPhone(input: string): boolean {
  return normalizeEthiopianPhone(input) !== null;
}

/** +251911223344 -> +251911***344 (for logs). */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone;
  return `${phone.slice(0, 7)}***${phone.slice(-3)}`;
}
