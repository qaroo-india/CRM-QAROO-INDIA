/**
 * PDF export of a report dataset (A4 landscape): summary with comparison,
 * two small charts, breakdown tables and the row lists. Uses the same
 * dataset as the screen and the Excel file.
 */

import type { InstituteInfo, ReportDataset } from '@ims/shared';
import { createDocument, drawHeader, drawTable, PDF_COLORS, sectionTitle, stampFooters, toBuffer, type Doc, type TableColumn } from '../../../pdf/document';
import { AGEING_TEXT, changeText, filterLine, formatters, label, summaryRows } from './shared';

const SERIES = ['#2a78d6', '#d97a1e'] as const;

function monthShort(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/**
 * Grouped columns for one or two series. Bars are at most 24pt wide, values
 * are printed above bars when there is room, and a legend appears only for
 * two series.
 */
function drawColumns(
  doc: Doc,
  title: string,
  categories: string[],
  series: { name: string; values: number[] }[],
  format: (v: number) => string,
  box: { x: number; y: number; width: number; height: number },
): void {
  const { x, y, width, height } = box;
  doc.font('Inter-SemiBold').fontSize(9.5).fillColor(PDF_COLORS.ink).text(title, x, y, { width });
  let top = y + 16;
  if (series.length > 1) {
    let lx = x;
    series.forEach((s, i) => {
      doc.rect(lx, top + 2, 7, 7).fill(SERIES[i]!);
      doc.font('Inter').fontSize(8).fillColor(PDF_COLORS.muted).text(s.name, lx + 10, top, { lineBreak: false });
      lx += 16 + doc.widthOfString(s.name);
    });
    top += 14;
  }
  const labelBand = 14;
  const plotTop = top + 10;
  const plotBottom = y + height - labelBand;
  const plotHeight = plotBottom - plotTop;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const n = Math.max(1, categories.length);
  const slot = width / n;
  const groupWidth = Math.min(slot * 0.7, 24 * series.length + 2 * (series.length - 1));
  const barWidth = (groupWidth - 2 * (series.length - 1)) / series.length;

  // Baseline and one mid gridline.
  doc.lineWidth(0.5).strokeColor(PDF_COLORS.rule);
  doc.moveTo(x, plotBottom).lineTo(x + width, plotBottom).stroke();
  doc.moveTo(x, plotTop + plotHeight / 2).lineTo(x + width, plotTop + plotHeight / 2).dash(2, { space: 2 }).stroke().undash();
  doc.font('Inter').fontSize(7).fillColor(PDF_COLORS.subtle).text(format(max / 2), x, plotTop + plotHeight / 2 - 9, { lineBreak: false });

  const showValues = n * series.length <= 16;
  const labelEvery = Math.ceil(n / 16);
  categories.forEach((cat, ci) => {
    const gx = x + ci * slot + (slot - groupWidth) / 2;
    series.forEach((s, si) => {
      const v = s.values[ci] ?? 0;
      const h = (v / max) * plotHeight;
      const bx = gx + si * (barWidth + 2);
      if (h > 0) doc.rect(bx, plotBottom - h, barWidth, h).fill(SERIES[si]!);
      if (showValues && v > 0) {
        doc.font('Inter').fontSize(6.5).fillColor(PDF_COLORS.muted).text(format(v), bx - 12, plotBottom - h - 9, { width: barWidth + 24, align: 'center', lineBreak: false });
      }
    });
    if (ci % labelEvery === 0) {
      doc.font('Inter').fontSize(7).fillColor(PDF_COLORS.subtle).text(cat, x + ci * slot, plotBottom + 3, { width: slot * labelEvery, align: 'center', lineBreak: false });
    }
  });
}

export async function renderReportPdf(data: ReportDataset, institute: InstituteInfo, generatedAt: Date): Promise<Buffer> {
  const f = formatters(institute);
  const doc = createDocument(`${data.label} ${f.range(data.range)}`, { landscape: true });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const fin = data.includesFinance;
  const stamp = new Intl.DateTimeFormat(institute.locale, { timeZone: data.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(generatedAt);

  drawHeader(
    doc,
    {
      name: institute.legalName || institute.name,
      lines: [institute.address, [institute.phone, institute.email].filter(Boolean).join(' · ')].filter((l): l is string => !!l),
    },
    data.label.toUpperCase(),
    [f.range(data.range), `Compared with ${f.range(data.previous)}`, `Generated ${stamp}`],
  );

  const notes = [
    filterLine(data),
    `Balances are as of the end of ${f.day(data.asOf)}. Dates are calendar days in ${data.timeZone}.`,
    !fin ? 'Financial figures are omitted: the requester does not have the financial reports permission.' : null,
    fin && data.summary.finance?.expensesMinor === null ? 'Expenses are institute-wide and are omitted while a course, source or counsellor filter is applied.' : null,
  ].filter((n): n is string => !!n);
  doc.font('Inter').fontSize(8.5).fillColor(PDF_COLORS.muted);
  for (const note of notes) doc.text(note, left, doc.y, { width });
  doc.y += 8;

  /* Summary + charts side by side */
  const summaryWidth = 380;
  const top = doc.y;
  sectionTitle(doc, 'Summary');
  const rows = summaryRows(data);
  drawTable(
    doc,
    [
      { header: 'Metric', width: 170 },
      { header: 'This period', width: 80, align: 'right' },
      { header: 'Previous', width: 80, align: 'right' },
      { header: 'Change', width: 50, align: 'right' },
    ],
    rows.map((r) => [r.label, f.value(r.kind, r.current), r.previous === null ? '—' : f.value(r.kind, r.previous), changeText(r, institute.locale)]),
    { zebra: true },
  );
  const afterSummary = doc.y;

  const chartX = left + summaryWidth + 24;
  const chartWidth = width - summaryWidth - 24;
  const cats = data.trend.map((t) => (data.bucket === 'month' ? monthShort(t.key, institute.locale) : t.key.slice(5).split('-').reverse().join('/')));
  drawColumns(doc, 'Enquiries and admissions', cats, [{ name: 'Enquiries', values: data.trend.map((t) => t.leads) }, { name: 'Admissions', values: data.trend.map((t) => t.admissions) }], (v) => f.count(Math.round(v)), { x: chartX, y: top, width: chartWidth, height: 150 });
  if (data.cashTrend) {
    drawColumns(doc, 'Net collections (receipts − refunds)', cats, [{ name: 'Net', values: data.cashTrend.map((c) => Math.max(0, c.collectedMinor - c.refundedMinor)) }], (v) => f.compactMoney(Math.round(v)), { x: chartX, y: top + 168, width: chartWidth, height: 150 });
  }
  doc.x = left;
  doc.y = Math.max(afterSummary, top + (data.cashTrend ? 330 : 165));

  const twoUp = (draw: () => void) => {
    if (doc.y + 120 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    draw();
  };

  /* Breakdowns */
  twoUp(() => {
    sectionTitle(doc, 'Lead sources');
    const cols: TableColumn[] = [
      { header: 'Source', width: 200 },
      { header: 'Enquiries', width: 80, align: 'right' },
      { header: 'Converted', width: 80, align: 'right' },
      { header: 'Rate', width: 70, align: 'right' },
      { header: 'Admissions', width: 80, align: 'right' },
      ...(fin ? [{ header: 'Net collected', width: 110, align: 'right' as const }] : []),
    ];
    const body = data.sources.map((s) => [s.name, f.count(s.leads), f.count(s.converted), f.ratio(s.conversionRate), f.count(s.admissions), ...(fin ? [f.money(s.collectedMinor)] : [])]);
    drawTable(doc, cols, body.length ? body : [['No enquiries or admissions in this period', '', '', '', '', ...(fin ? [''] : [])]], { zebra: true });
  });

  twoUp(() => {
    sectionTitle(doc, 'Courses');
    const cols: TableColumn[] = [
      { header: 'Course', width: 220 },
      { header: 'Enquiries', width: 70, align: 'right' },
      { header: 'Admissions', width: 80, align: 'right' },
      ...(fin
        ? [
            { header: 'Agreed fees', width: 110, align: 'right' as const },
            { header: 'Net collected', width: 110, align: 'right' as const },
            { header: `Outstanding`, width: 110, align: 'right' as const },
          ]
        : []),
    ];
    const body = data.courses.map((c) => [c.name, f.count(c.leads), f.count(c.admissions), ...(fin ? [f.money(c.agreedFeeMinor), f.money(c.collectedMinor), f.money(c.outstandingMinor)] : [])]);
    drawTable(doc, cols, body.length ? body : [['No course activity in this period', '', '', ...(fin ? ['', '', ''] : [])]], { zebra: true });
  });

  twoUp(() => {
    sectionTitle(doc, 'Counsellor performance');
    const cols: TableColumn[] = [
      { header: 'Counsellor', width: 200 },
      { header: 'Enquiries', width: 80, align: 'right' },
      { header: 'Converted', width: 80, align: 'right' },
      { header: 'Conversion', width: 80, align: 'right' },
      { header: 'Admissions', width: 80, align: 'right' },
      ...(fin ? [{ header: 'Net collected', width: 110, align: 'right' as const }] : []),
    ];
    const body = data.counsellors.map((c) => [c.name, f.count(c.leads), f.count(c.converted), f.ratio(c.conversionRate), f.count(c.admissions), ...(fin ? [f.money(c.collectedMinor)] : [])]);
    drawTable(doc, cols, body.length ? body : [['No activity in this period', '', '', '', '', ...(fin ? [''] : [])]], { zebra: true });
  });

  twoUp(() => {
    sectionTitle(doc, 'Placement (students who became eligible in the period)');
    drawTable(
      doc,
      [
        { header: 'Track', width: 200 },
        { header: 'Eligible', width: 80, align: 'right' },
        { header: 'Offered', width: 80, align: 'right' },
        { header: 'Joined', width: 80, align: 'right' },
        { header: 'Placement rate', width: 100, align: 'right' },
      ],
      data.placements.map((p) => [p.track === 'technical' ? 'Technical' : 'Non-technical', f.count(p.eligible), f.count(p.offered), f.count(p.joined), f.ratio(p.placementRate)]),
      { zebra: true },
    );
  });

  if (data.ageing) {
    twoUp(() => {
      sectionTitle(doc, `Receivables ageing at end of ${f.day(data.asOf)}`);
      const total = data.ageing!.reduce((s, a) => s + a.amountMinor, 0);
      drawTable(
        doc,
        [{ header: 'Age', width: 200 }, { header: 'Amount', width: 130, align: 'right' }],
        [...data.ageing!.map((a) => [AGEING_TEXT[a.bucket] ?? a.bucket, f.money(a.amountMinor)]), ['Total outstanding', f.money(total)]],
        { boldLastRow: true },
      );
    });
  }
  if (data.paymentMethods) {
    twoUp(() => {
      sectionTitle(doc, 'Receipts by payment method');
      drawTable(
        doc,
        [{ header: 'Method', width: 200 }, { header: 'Receipts', width: 80, align: 'right' }, { header: 'Amount', width: 130, align: 'right' }],
        data.paymentMethods!.length ? data.paymentMethods!.map((m) => [label(m.method), f.count(m.receipts), f.money(m.amountMinor)]) : [['No receipts in this period', '', '']],
        { zebra: true },
      );
    });
  }
  if (data.expenseCategories) {
    twoUp(() => {
      sectionTitle(doc, 'Expenses by category');
      const total = data.expenseCategories!.reduce((s, c) => s + c.amountMinor, 0);
      drawTable(
        doc,
        [{ header: 'Category', width: 200 }, { header: 'Entries', width: 80, align: 'right' }, { header: 'Amount', width: 130, align: 'right' }],
        data.expenseCategories!.length ? [...data.expenseCategories!.map((c) => [c.name, f.count(c.count), f.money(c.amountMinor)]), ['Total', '', f.money(total)]] : [['No expenses in this period', '', '']],
        { zebra: true, boldLastRow: data.expenseCategories!.length > 0 },
      );
    });
  }

  /* Row lists, each from a fresh page */
  const truncatedNote = (truncated: boolean, n: number) => {
    if (!truncated) return;
    doc.font('Inter').fontSize(8.5).fillColor(PDF_COLORS.danger).text(`Showing the first ${f.count(n)} rows; the summary totals cover everything. Export to Excel or narrow the period for the full list.`, left, doc.y, { width });
    doc.y += 4;
  };

  doc.addPage();
  sectionTitle(doc, 'Admissions in the period (excluding cancelled)');
  truncatedNote(data.truncated.admissions, data.admissionRows.length);
  {
    const cols: TableColumn[] = [
      { header: 'Admission', width: 92 },
      { header: 'Date', width: 64 },
      { header: 'Student', width: fin ? 120 : 170 },
      { header: 'Course', width: fin ? 120 : 170 },
      { header: 'Source', width: 80 },
      { header: 'Counsellor', width: 80 },
      ...(fin
        ? [
            { header: 'Agreed', width: 64, align: 'right' as const },
            { header: 'Net paid', width: 62, align: 'right' as const },
            { header: 'Owed', width: 62, align: 'right' as const },
          ]
        : []),
    ];
    const body = data.admissionRows.map((a) => [a.admissionNumber, f.day(a.admissionDate), a.studentName, a.courseName, a.sourceName ?? '—', a.counsellorName ?? '—', ...(fin ? [f.money(a.agreedFeeMinor), f.money(a.paidMinor), f.money(a.outstandingMinor)] : [])]);
    if (fin && body.length) {
      const t = (k: 'agreedFeeMinor' | 'paidMinor' | 'outstandingMinor') => f.money(data.admissionRows.reduce((s, a) => s + (a[k] ?? 0), 0));
      body.push(['Total', '', `${f.count(body.length)} admissions`, '', '', '', t('agreedFeeMinor'), t('paidMinor'), t('outstandingMinor')]);
    }
    drawTable(doc, cols, body.length ? body : [['No admissions in this period', '', '', '', '', '', ...(fin ? ['', '', ''] : [])]], { zebra: true, boldLastRow: fin && body.length > 1 });
  }

  if (data.paymentRows) {
    doc.addPage();
    sectionTitle(doc, 'Receipts and refunds (refunds negative; reversed receipts excluded)');
    truncatedNote(data.truncated.payments, data.paymentRows.length);
    const body = data.paymentRows.map((p) => [p.receiptNumber, f.day(p.paymentDate), p.studentName, p.admissionNumber, p.courseName, p.direction === 'refund' ? 'Refund' : label(p.paymentType), label(p.method), f.money(p.amountMinor)]);
    if (body.length) body.push(['Net total', '', '', '', '', '', '', f.money(data.paymentRows.reduce((s, p) => s + p.amountMinor, 0))]);
    drawTable(
      doc,
      [
        { header: 'Receipt', width: 92 },
        { header: 'Date', width: 64 },
        { header: 'Student', width: 130 },
        { header: 'Admission', width: 92 },
        { header: 'Course', width: 130 },
        { header: 'For', width: 80 },
        { header: 'Method', width: 70 },
        { header: 'Amount', width: 88, align: 'right' },
      ],
      body.length ? body : [['No receipts in this period', '', '', '', '', '', '', '']],
      { zebra: true, boldLastRow: body.length > 0 },
    );
  }

  if (data.expenseRows) {
    doc.addPage();
    sectionTitle(doc, 'Expenses (recorded and approved)');
    truncatedNote(data.truncated.expenses, data.expenseRows.length);
    const body = data.expenseRows.map((e) => [e.expenseCode, f.day(e.expenseDate), e.categoryName, e.description, e.payee ?? '—', label(e.method), f.money(e.amountMinor)]);
    if (body.length) body.push(['Total', '', '', '', '', '', f.money(data.expenseRows.reduce((s, e) => s + e.amountMinor, 0))]);
    drawTable(
      doc,
      [
        { header: 'Expense', width: 92 },
        { header: 'Date', width: 64 },
        { header: 'Category', width: 110 },
        { header: 'Description', width: 210 },
        { header: 'Payee', width: 110 },
        { header: 'Method', width: 72 },
        { header: 'Amount', width: 88, align: 'right' },
      ],
      body.length ? body : [['No expenses in this period', '', '', '', '', '', '']],
      { zebra: true, boldLastRow: body.length > 0 },
    );
  }

  stampFooters(doc, `${institute.name} · ${data.label} · ${f.range(data.range)} · Confidential`);
  return toBuffer(doc);
}
