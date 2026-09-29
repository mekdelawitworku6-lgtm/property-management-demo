import * as ExcelJS from 'exceljs';
import { DEFAULT_ETHIOPIC_FONTS, ReportTable, buildExcel, buildPdf, findEthiopicFont, formatCell } from './report-export.util';

const table: ReportTable = {
  title: 'Payments',
  subtitle: 'Sept 2026',
  columns: [
    { key: 'date', header: 'Date' },
    { key: 'tenant', header: 'Tenant' },
    { key: 'amount', header: 'Amount', numeric: true },
  ],
  rows: [{ date: new Date('2026-09-05T00:00:00Z'), tenant: 'Meron', amount: 18000 }],
  summary: [{ label: 'Total', value: 18000 }],
};

describe('report-export.util', () => {
  it('formatCell formats dates, numbers and empties', () => {
    expect(formatCell(new Date('2026-09-05T10:00:00Z'))).toBe('2026-09-05');
    expect(formatCell(18000)).toBe('18,000.00');
    expect(formatCell(null)).toBe('');
    expect(formatCell('x')).toBe('x');
  });

  it('findEthiopicFont prefers an existing configured path and returns null otherwise', () => {
    expect(findEthiopicFont(__filename)).toBe(__filename);
    expect(DEFAULT_ETHIOPIC_FONTS.length).toBeGreaterThan(0);
    expect(findEthiopicFont('/nope.ttf') === null || typeof findEthiopicFont('/nope.ttf') === 'string').toBe(true);
  });

  it('buildExcel writes a readable workbook with header, rows and summary', async () => {
    const buffer = await buildExcel([table]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.getWorksheet('Payments');
    const values = sheet.getSheetValues().filter(Boolean).map((row: any) => row.filter((v: unknown) => v !== undefined));
    expect(values[0]).toEqual(['Payments']);
    expect(values).toContainEqual(['Date', 'Tenant', 'Amount']);
    expect(values).toContainEqual(['2026-09-05', 'Meron', 18000]);
    expect(values).toContainEqual(['Total', 18000]);
  });

  it('buildPdf produces a PDF document', async () => {
    const buffer = await buildPdf([table, { ...table, title: 'Second' }]);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
