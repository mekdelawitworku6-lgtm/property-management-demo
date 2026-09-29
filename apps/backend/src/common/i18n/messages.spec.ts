import { Language } from '@prisma/client';
import { MESSAGES, REPORT_LABELS, fillTemplate, reportLabels, translate } from './messages';

describe('i18n messages', () => {
  it('fillTemplate replaces known params and keeps unknown placeholders', () => {
    expect(fillTemplate('Hi {name}, {missing}', { name: 'Abebe' })).toBe('Hi Abebe, {missing}');
  });

  it('translate returns English and Amharic variants', () => {
    const en = translate('PAYMENT_RECEIVED', Language.EN, { amount: 100, reference: 'PAY-1' });
    const am = translate('PAYMENT_RECEIVED', Language.AM, { amount: 100, reference: 'PAY-1' });
    expect(en.body).toContain('100 ETB');
    expect(am.title).toBe('ክፍያ ተቀብለናል');
    expect(am.body).toContain('PAY-1');
  });

  it('every message key has both languages', () => {
    for (const entry of Object.values(MESSAGES)) {
      expect(entry.EN.title).toBeTruthy();
      expect(entry.AM.title).toBeTruthy();
    }
  });

  it('reportLabels selects the language with identical keys', () => {
    expect(reportLabels(Language.AM).income).toBe('ገቢ');
    expect(reportLabels('EN').income).toBe('Income');
    expect(Object.keys(REPORT_LABELS.AM).sort()).toEqual(Object.keys(REPORT_LABELS.EN).sort());
  });
});
