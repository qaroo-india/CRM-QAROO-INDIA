/**
 * Reading and writing simple tables (CSV and the first sheet of an .xlsx),
 * for bulk import and list exports.
 */

import ExcelJS from 'exceljs';
import { sanitizeCell } from '../modules/reports/render/excel';

export interface Table {
  headers: string[];
  rows: string[][];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Excel dates are stored as UTC midnight for a calendar day.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('error' in value) return '';
  }
  return String(value);
}

export async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  const width = ws.columnCount;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c += 1) cells.push(cellText(row.getCell(c).value).trim());
    if (cells.some((v) => v !== '')) rows.push(cells);
  });
  return rows;
}

export async function readTable(buffer: Buffer, fileName: string): Promise<Table> {
  const lower = fileName.toLowerCase();
  const raw = lower.endsWith('.xlsx') ? await readXlsx(buffer) : parseCsv(buffer.toString('utf8'));
  const [headers = [], ...rows] = raw;
  return { headers: headers.map((h) => h.trim()), rows };
}

/** CSV with every field quoted and formula triggers neutralised. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const quote = (v: string | number | null | undefined) => {
    const text = v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : sanitizeCell(v);
    return `"${text.replace(/"/g, '""')}"`;
  };
  // BOM so Excel opens UTF-8 (₹, names in Indian scripts) correctly.
  return `﻿${[headers.map(quote).join(','), ...rows.map((r) => r.map(quote).join(','))].join('\r\n')}\r\n`;
}
