/**
 * Excel export of a report dataset.
 *
 * - Money is written in major units (rupees) with a currency number format,
 *   so cells are real numbers that sum and chart in Excel.
 * - Business dates are real Excel dates (UTC midnight, so the day never shifts).
 * - Totals are live SUM formulas with the computed result cached, so they
 *   show correctly even in viewers that do not recalculate.
 * - Every text cell is neutralised against formula injection: a name typed as
 *   "=HYPERLINK(...)" by a lead form is written as inert text.
 */

import ExcelJS from 'exceljs';
import type { InstituteInfo, ReportDataset } from '@ims/shared';
import { AGEING_TEXT, changeText, filterLine, formatters, label, summaryRows } from './shared';

/** Leading characters that make spreadsheet software treat text as a formula. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function sanitizeCell(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

type Kind = 'text' | 'money' | 'count' | 'date' | 'ratio';

interface Column<T> {
  header: string;
  width: number;
  kind: Kind;
  value: (row: T) => string | number | null;
  /** Add a SUM to the totals row. */
  total?: boolean;
}

function currencySymbol(institute: InstituteInfo): string {
  try {
    return new Intl.NumberFormat(institute.locale, { style: 'currency', currency: institute.currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? institute.currency;
  } catch {
    return institute.currency;
  }
}

function toExcelDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function columnLetter(index: number): string {
  let n = index;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function renderReportExcel(data: ReportDataset, institute: InstituteInfo, generatedAt: Date): Promise<Buffer> {
  const f = formatters(institute);
  const symbol = currencySymbol(institute);
  const MONEY_FMT = `"${symbol}"#,##0.00;-"${symbol}"#,##0.00`;
  const COUNT_FMT = '#,##0';
  const RATIO_FMT = '0.0%';
  const DATE_FMT = 'dd-mmm-yyyy';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Institute OS';
  wb.created = generatedAt;
  wb.title = `${data.label} ${f.range(data.range)}`;

  const preamble = (ws: ExcelJS.Worksheet, title: string): number => {
    ws.addRow([sanitizeCell(institute.legalName || institute.name)]).font = { bold: true, size: 14 };
    ws.addRow([sanitizeCell(title)]).font = { bold: true, size: 12 };
    ws.addRow([`${data.label}: ${f.range(data.range)} · compared with ${f.range(data.previous)} · balances as of ${f.day(data.asOf)}`]);
    const filters = filterLine(data);
    ws.addRow([`Generated ${generatedAt.toISOString()} (${data.timeZone})${filters ? ` · ${filters}` : ''}`]).font = { color: { argb: 'FF64748B' } };
    ws.addRow([]);
    return ws.rowCount + 1;
  };

  function table<T>(name: string, title: string, columns: Column<T>[], rows: T[], options: { note?: string; totals?: boolean } = {}) {
    const ws = wb.addWorksheet(name);
    const headerRow = preamble(ws, title);
    if (options.note) {
      // Insert the note above the header.
      ws.getRow(headerRow - 1).getCell(1).value = options.note;
      ws.getRow(headerRow - 1).getCell(1).font = { italic: true, color: { argb: 'FF92400E' } };
      ws.addRow([]);
    }
    const header = ws.addRow(columns.map((c) => c.header));
    header.font = { bold: true, color: { argb: 'FF0F172A' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
    });
    const hRow = header.number;
    columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width;
      if (c.kind === 'money' || c.kind === 'count' || c.kind === 'ratio') ws.getColumn(i + 1).alignment = { horizontal: 'right' };
    });

    for (const row of rows) {
      const values = columns.map((c) => {
        const v = c.value(row);
        if (v === null || v === undefined) return null;
        if (c.kind === 'money') return Number(v) / 100;
        if (c.kind === 'date') return typeof v === 'string' && v ? toExcelDate(v) : null;
        if (c.kind === 'text') return sanitizeCell(String(v));
        return v;
      });
      const added = ws.addRow(values);
      columns.forEach((c, i) => {
        const cell = added.getCell(i + 1);
        if (c.kind === 'money') cell.numFmt = MONEY_FMT;
        if (c.kind === 'count') cell.numFmt = COUNT_FMT;
        if (c.kind === 'ratio') cell.numFmt = RATIO_FMT;
        if (c.kind === 'date') cell.numFmt = DATE_FMT;
      });
    }

    const first = hRow + 1;
    const last = hRow + rows.length;
    if (options.totals && rows.length > 0) {
      const totalRow = ws.addRow(columns.map((_, i) => (i === 0 ? 'Total' : null)));
      totalRow.font = { bold: true };
      columns.forEach((c, i) => {
        if (!c.total) return;
        const letter = columnLetter(i + 1);
        const result = rows.reduce((s, r) => s + Number(c.value(r) ?? 0), 0);
        const cell = totalRow.getCell(i + 1);
        cell.value = { formula: `SUM(${letter}${first}:${letter}${last})`, result: c.kind === 'money' ? result / 100 : result };
        cell.numFmt = c.kind === 'money' ? MONEY_FMT : COUNT_FMT;
        cell.border = { top: { style: 'thin', color: { argb: 'FF0F172A' } } };
      });
    }
    ws.views = [{ state: 'frozen', ySplit: hRow }];
    if (rows.length > 0) ws.autoFilter = { from: { row: hRow, column: 1 }, to: { row: last, column: columns.length } };
    return { ws, headerRow: hRow };
  }

  /* Summary ------------------------------------------------------------ */
  {
    const rows = summaryRows(data);
    const { ws, headerRow } = table(
      'Summary',
      'Summary',
      [
        { header: 'Metric', width: 44, kind: 'text', value: (r) => r.label },
        { header: 'This period', width: 18, kind: 'text', value: () => null },
        { header: 'Previous period', width: 18, kind: 'text', value: () => null },
        { header: 'Change', width: 14, kind: 'text', value: (r) => changeText(r, institute.locale) },
      ],
      rows,
    );
    // Typed cells per row kind (a column cannot have one format here).
    rows.forEach((r, index) => {
      const row = ws.getRow(headerRow + 1 + index);
      const fmt = r.kind === 'money' ? MONEY_FMT : r.kind === 'ratio' ? RATIO_FMT : COUNT_FMT;
      const scale = (v: number | null) => (v === null ? '—' : r.kind === 'money' ? v / 100 : v);
      row.getCell(2).value = scale(r.current);
      row.getCell(3).value = r.previous === null ? 'n/a' : scale(r.previous);
      row.getCell(2).numFmt = fmt;
      row.getCell(3).numFmt = fmt;
      row.getCell(2).alignment = { horizontal: 'right' };
      row.getCell(3).alignment = { horizontal: 'right' };
      row.getCell(4).alignment = { horizontal: 'right' };
    });
  }

  /* Trend -------------------------------------------------------------- */
  {
    const cash = new Map((data.cashTrend ?? []).map((c) => [c.key, c]));
    const fin = data.includesFinance;
    const withExpenses = fin && data.cashTrend?.[0]?.expensesMinor !== null && data.cashTrend !== null && data.cashTrend.length > 0;
    table(
      'Trend',
      `Per ${data.bucket}`,
      [
        { header: data.bucket === 'month' ? 'Month' : data.bucket === 'week' ? 'Week starting' : 'Day', width: 16, kind: data.bucket === 'month' ? 'text' : 'date', value: (r) => r.key },
        { header: 'Enquiries', width: 12, kind: 'count', value: (r) => r.leads, total: true },
        { header: 'Admissions', width: 12, kind: 'count', value: (r) => r.admissions, total: true },
        ...(fin
          ? ([
              { header: 'Collected', width: 16, kind: 'money', value: (r) => cash.get(r.key)?.collectedMinor ?? 0, total: true },
              { header: 'Refunded', width: 16, kind: 'money', value: (r) => cash.get(r.key)?.refundedMinor ?? 0, total: true },
              { header: 'Net collections', width: 16, kind: 'money', value: (r) => (cash.get(r.key)?.collectedMinor ?? 0) - (cash.get(r.key)?.refundedMinor ?? 0), total: true },
              ...(withExpenses ? ([{ header: 'Expenses', width: 16, kind: 'money', value: (r) => cash.get(r.key)?.expensesMinor ?? 0, total: true }] as Column<(typeof data.trend)[number]>[]) : []),
            ] as Column<(typeof data.trend)[number]>[])
          : []),
      ],
      data.trend,
      { totals: true },
    );
  }

  /* Breakdowns --------------------------------------------------------- */
  const fin = data.includesFinance;
  table(
    'Lead sources',
    'Lead sources',
    [
      { header: 'Source', width: 28, kind: 'text', value: (r) => r.name },
      { header: 'Enquiries', width: 12, kind: 'count', value: (r) => r.leads, total: true },
      { header: 'Converted by period end', width: 14, kind: 'count', value: (r) => r.converted, total: true },
      { header: 'Conversion rate', width: 14, kind: 'ratio', value: (r) => r.conversionRate },
      { header: 'Admissions', width: 12, kind: 'count', value: (r) => r.admissions, total: true },
      ...(fin ? ([{ header: 'Net collected', width: 16, kind: 'money', value: (r) => r.collectedMinor, total: true }] as Column<(typeof data.sources)[number]>[]) : []),
    ],
    data.sources,
    { totals: true },
  );
  table(
    'Courses',
    'Courses',
    [
      { header: 'Course', width: 32, kind: 'text', value: (r) => r.name },
      { header: 'Enquiries', width: 12, kind: 'count', value: (r) => r.leads, total: true },
      { header: 'Admissions', width: 12, kind: 'count', value: (r) => r.admissions, total: true },
      ...(fin
        ? ([
            { header: 'Agreed fees', width: 16, kind: 'money', value: (r) => r.agreedFeeMinor, total: true },
            { header: 'Net collected', width: 16, kind: 'money', value: (r) => r.collectedMinor, total: true },
            { header: `Outstanding at ${data.asOf}`, width: 18, kind: 'money', value: (r) => r.outstandingMinor, total: true },
          ] as Column<(typeof data.courses)[number]>[])
        : []),
    ],
    data.courses,
    { totals: true },
  );
  table(
    'Counsellors',
    'Counsellor performance',
    [
      { header: 'Counsellor', width: 26, kind: 'text', value: (r) => r.name },
      { header: 'Enquiries', width: 12, kind: 'count', value: (r) => r.leads, total: true },
      { header: 'Converted', width: 12, kind: 'count', value: (r) => r.converted, total: true },
      { header: 'Conversion rate', width: 14, kind: 'ratio', value: (r) => r.conversionRate },
      { header: 'Admissions', width: 12, kind: 'count', value: (r) => r.admissions, total: true },
      ...(fin ? ([{ header: 'Net collected', width: 16, kind: 'money', value: (r) => r.collectedMinor, total: true }] as Column<(typeof data.counsellors)[number]>[]) : []),
    ],
    data.counsellors,
    { totals: true },
  );
  table(
    'Placement',
    'Placement (students eligible in the period)',
    [
      { header: 'Track', width: 18, kind: 'text', value: (r) => (r.track === 'technical' ? 'Technical' : 'Non-technical') },
      { header: 'Eligible', width: 12, kind: 'count', value: (r) => r.eligible, total: true },
      { header: 'Offered', width: 12, kind: 'count', value: (r) => r.offered, total: true },
      { header: 'Joined', width: 12, kind: 'count', value: (r) => r.joined, total: true },
      { header: 'Placement rate', width: 14, kind: 'ratio', value: (r) => r.placementRate },
    ],
    data.placements,
    { totals: true },
  );

  if (data.ageing) {
    table('Receivables ageing', `Outstanding by age at end of ${f.day(data.asOf)}`, [
      { header: 'Age', width: 26, kind: 'text', value: (r) => AGEING_TEXT[r.bucket] ?? r.bucket },
      { header: 'Amount', width: 18, kind: 'money', value: (r) => r.amountMinor, total: true },
    ], data.ageing, { totals: true });
  }
  if (data.paymentMethods) {
    table('Payment methods', 'Receipts by payment method', [
      { header: 'Method', width: 20, kind: 'text', value: (r) => label(r.method) },
      { header: 'Receipts', width: 12, kind: 'count', value: (r) => r.receipts, total: true },
      { header: 'Amount', width: 18, kind: 'money', value: (r) => r.amountMinor, total: true },
    ], data.paymentMethods, { totals: true });
  }
  if (data.expenseCategories) {
    table('Expense categories', 'Expenses by category', [
      { header: 'Category', width: 26, kind: 'text', value: (r) => r.name },
      { header: 'Entries', width: 12, kind: 'count', value: (r) => r.count, total: true },
      { header: 'Amount', width: 18, kind: 'money', value: (r) => r.amountMinor, total: true },
    ], data.expenseCategories, { totals: true });
  }

  /* Row lists ---------------------------------------------------------- */
  const cap = (truncated: boolean, n: number) => (truncated ? `Showing the first ${n.toLocaleString(institute.locale)} rows. Narrow the period or filters for the full list; the Summary sheet totals cover everything.` : undefined);
  table(
    'Admissions',
    'Admissions in the period (excluding cancelled)',
    [
      { header: 'Admission no.', width: 18, kind: 'text', value: (r) => r.admissionNumber },
      { header: 'Date', width: 13, kind: 'date', value: (r) => r.admissionDate },
      { header: 'Student', width: 24, kind: 'text', value: (r) => r.studentName },
      { header: 'Phone', width: 15, kind: 'text', value: (r) => r.studentPhone },
      { header: 'Course', width: 24, kind: 'text', value: (r) => r.courseName },
      { header: 'Source', width: 18, kind: 'text', value: (r) => r.sourceName },
      { header: 'Counsellor', width: 18, kind: 'text', value: (r) => r.counsellorName },
      { header: 'Status', width: 14, kind: 'text', value: (r) => label(r.status) },
      ...(fin
        ? ([
            { header: 'Agreed fee', width: 15, kind: 'money', value: (r) => r.agreedFeeMinor, total: true },
            { header: `Net paid by ${data.asOf}`, width: 16, kind: 'money', value: (r) => r.paidMinor, total: true },
            { header: `Outstanding at ${data.asOf}`, width: 17, kind: 'money', value: (r) => r.outstandingMinor, total: true },
          ] as Column<(typeof data.admissionRows)[number]>[])
        : []),
    ],
    data.admissionRows,
    { totals: true, note: cap(data.truncated.admissions, data.admissionRows.length) },
  );
  if (data.paymentRows) {
    table(
      'Payments',
      'Receipts and refunds in the period (refunds negative; reversed receipts excluded)',
      [
        { header: 'Receipt no.', width: 18, kind: 'text', value: (r) => r.receiptNumber },
        { header: 'Date', width: 13, kind: 'date', value: (r) => r.paymentDate },
        { header: 'Student', width: 24, kind: 'text', value: (r) => r.studentName },
        { header: 'Admission no.', width: 18, kind: 'text', value: (r) => r.admissionNumber },
        { header: 'Course', width: 24, kind: 'text', value: (r) => r.courseName },
        { header: 'Type', width: 12, kind: 'text', value: (r) => (r.direction === 'refund' ? 'Refund' : 'Receipt') },
        { header: 'For', width: 16, kind: 'text', value: (r) => label(r.paymentType) },
        { header: 'Method', width: 14, kind: 'text', value: (r) => label(r.method) },
        { header: 'Amount', width: 16, kind: 'money', value: (r) => r.amountMinor, total: true },
      ],
      data.paymentRows,
      { totals: true, note: cap(data.truncated.payments, data.paymentRows.length) },
    );
  }
  if (data.expenseRows) {
    table(
      'Expenses',
      'Expenses in the period (recorded and approved)',
      [
        { header: 'Expense no.', width: 18, kind: 'text', value: (r) => r.expenseCode },
        { header: 'Date', width: 13, kind: 'date', value: (r) => r.expenseDate },
        { header: 'Category', width: 20, kind: 'text', value: (r) => r.categoryName },
        { header: 'Description', width: 36, kind: 'text', value: (r) => r.description },
        { header: 'Payee', width: 20, kind: 'text', value: (r) => r.payee },
        { header: 'Method', width: 14, kind: 'text', value: (r) => label(r.method) },
        { header: 'Amount', width: 16, kind: 'money', value: (r) => r.amountMinor, total: true },
      ],
      data.expenseRows,
      { totals: true, note: cap(data.truncated.expenses, data.expenseRows.length) },
    );
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
