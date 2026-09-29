import { existsSync } from 'fs';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface ReportColumn {
  key: string;
  header: string;
  width?: number;
  numeric?: boolean;
}

export interface ReportTable {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  summary?: Array<{ label: string; value: string | number }>;
}

export const DEFAULT_ETHIOPIC_FONTS = [
  '/usr/share/fonts/truetype/noto/NotoSansEthiopic-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSerifEthiopic-Regular.ttf',
];

/** Finds an Ethiopic-capable TTF font (needed to render Amharic in PDFs). */
export function findEthiopicFont(configured?: string): string | null {
  const candidates = [configured, ...DEFAULT_ETHIOPIC_FONTS].filter(Boolean) as string[];
  return candidates.find((path) => existsSync(path)) ?? null;
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(value);
}

/** Builds an .xlsx workbook (one sheet per table). */
export async function buildExcel(tables: ReportTable[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Property Management Platform';
  workbook.created = new Date();
  tables.forEach((table, index) => {
    const sheet = workbook.addWorksheet(table.title.slice(0, 28) || `Sheet${index + 1}`);
    sheet.addRow([table.title]).font = { bold: true, size: 14 };
    if (table.subtitle) sheet.addRow([table.subtitle]);
    sheet.addRow([]);
    const header = sheet.addRow(table.columns.map((c) => c.header));
    header.font = { bold: true };
    table.columns.forEach((c, i) => (sheet.getColumn(i + 1).width = c.width ?? 18));
    for (const row of table.rows) {
      sheet.addRow(table.columns.map((c) => {
        const v = row[c.key];
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return c.numeric ? Number(v ?? 0) : (v ?? '');
      }));
    }
    if (table.summary?.length) {
      sheet.addRow([]);
      for (const s of table.summary) sheet.addRow([s.label, s.value]).font = { bold: true };
    }
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/** Builds a simple tabular PDF. Pass an Ethiopic font path to render Amharic text. */
export function buildPdf(tables: ReportTable[], fontPath?: string | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (fontPath) doc.font(fontPath);

    tables.forEach((table, tableIndex) => {
      if (tableIndex > 0) doc.addPage();
      doc.fontSize(16).text(table.title);
      if (table.subtitle) doc.fontSize(10).text(table.subtitle);
      doc.moveDown();
      const usable = doc.page.width - 80;
      const totalWeight = table.columns.reduce((acc, c) => acc + (c.width ?? 18), 0);
      const widths = table.columns.map((c) => ((c.width ?? 18) / totalWeight) * usable);
      const drawRow = (cells: string[], bold = false) => {
        if (doc.y > doc.page.height - 60) doc.addPage();
        const y = doc.y;
        let x = 40;
        doc.fontSize(bold ? 9.5 : 9);
        cells.forEach((cell, i) => {
          doc.text(cell, x, y, { width: widths[i] - 4, align: table.columns[i]?.numeric ? 'right' : 'left' });
          x += widths[i];
        });
        doc.x = 40;
        doc.moveDown(0.6);
      };
      drawRow(table.columns.map((c) => c.header), true);
      for (const row of table.rows) drawRow(table.columns.map((c) => formatCell(row[c.key])));
      if (table.summary?.length) {
        doc.moveDown();
        for (const s of table.summary) doc.fontSize(10).text(`${s.label}: ${formatCell(s.value)}`, 40);
      }
    });
    doc.end();
  });
}
