import {
  buildAgreementContent, computeEndDate, computeSignatureHash, hashContent, verifyAgreementIntegrity,
} from './agreement-content.util';

const input = {
  referenceNo: 'AGR-1',
  owner: { fullName: 'Abebe', phoneNumber: '+251911000003' },
  tenant: { fullName: 'Meron', phoneNumber: '+251911000005' },
  property: { name: 'Bole Heights', address: 'Bole Rd', city: 'Addis Ababa', subCity: 'Bole' },
  unit: { unitNumber: 'A-101', type: 'APARTMENT' },
  startDate: new Date('2026-10-01T00:00:00Z'),
  endDate: new Date('2027-09-30T00:00:00Z'),
  rentAmount: 18000,
  depositAmount: 36000,
  paymentDueDay: 5,
};

describe('agreement-content.util', () => {
  it('computeEndDate returns an inclusive end date', () => {
    expect(computeEndDate(new Date('2026-10-01T00:00:00Z'), 12).toISOString()).toBe('2027-09-30T00:00:00.000Z');
    expect(computeEndDate(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-27T00:00:00.000Z');
  });

  it('buildAgreementContent renders bilingual terms, optional sections', () => {
    const text = buildAgreementContent({ ...input, specialTerms: 'No pets', unitTerms: 'Quiet hours' });
    expect(text).toContain('AGR-1');
    expect(text).toContain('Monthly rent: 18000.00 ETB, due on day 5');
    expect(text).toContain('የኪራይ ውል');
    expect(text).toContain('No pets');
    expect(text).toContain('Quiet hours');
    expect(buildAgreementContent(input)).not.toContain('SPECIAL TERMS');
  });

  it('hashContent is sha256 of the content', () => {
    expect(hashContent('abc')).toHaveLength(64);
    expect(hashContent('abc')).toBe(hashContent('abc'));
  });

  it('computeSignatureHash binds hash, tenant, time and name', () => {
    const at = new Date('2026-09-29T10:00:00Z');
    const base = computeSignatureHash('h', 't', at, 'Meron');
    expect(computeSignatureHash('h', 't', at, 'Other')).not.toBe(base);
    expect(computeSignatureHash('h', 't2', at, 'Meron')).not.toBe(base);
  });

  it('verifyAgreementIntegrity detects tampering', () => {
    const content = buildAgreementContent(input);
    const contentHash = hashContent(content);
    const signedAt = new Date('2026-09-29T10:00:00Z');
    const signed = {
      content, contentHash, tenantId: 't', tenantSignedAt: signedAt, tenantSignature: 'Meron',
      signatureHash: computeSignatureHash(contentHash, 't', signedAt, 'Meron'),
    };
    expect(verifyAgreementIntegrity(signed)).toEqual({ contentValid: true, signatureValid: true });
    expect(verifyAgreementIntegrity({ ...signed, content: content + 'x' }).contentValid).toBe(false);
    expect(verifyAgreementIntegrity({ ...signed, tenantSignature: 'Forged' }).signatureValid).toBe(false);
    expect(verifyAgreementIntegrity({ content, contentHash, tenantId: 't' })).toEqual({ contentValid: true, signatureValid: null });
  });
});
