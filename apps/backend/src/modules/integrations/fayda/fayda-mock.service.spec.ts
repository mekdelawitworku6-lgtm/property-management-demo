import { FaydaMockService } from './fayda-mock.service';

describe('FaydaMockService', () => {
  const service = new FaydaMockService();

  it('verifies a well-formed mock ID', () => {
    const result = service.verify({ faydaId: ' fayda-12345678 ' });
    expect(result.verified).toBe(true);
    expect(result.reference).toMatch(/^FMK-/);
    expect(result.verifiedAt).toBeInstanceOf(Date);
  });

  it.each(['FAYDA-FAIL01', 'FAYDA-INVALID', 'FAYDA-NO_MATCH'])('rejects the mock failure marker %s', (faydaId) => {
    const result = service.verify({ faydaId });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain('mock Fayda provider');
  });
});
