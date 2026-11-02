/**
 * Printable payment receipt / refund voucher.
 */

import { formatDateOnly, formatMoney, type ReceiptDto } from '@ims/shared';
import { createDocument, drawHeader, drawTable, PDF_COLORS, stampFooters, toBuffer } from './document';

const label = (value: string) => value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export async function renderReceiptPdf(receipt: ReceiptDto, generatedAt: Date, timeZone: string): Promise<Buffer> {
  const { payment, institute } = receipt;
  const money = (minor: number) => formatMoney(minor, { currency: institute.currency, locale: institute.locale });
  const isRefund = payment.direction === 'refund';
  const doc = createDocument(`${isRefund ? 'Refund voucher' : 'Receipt'} ${payment.receiptNumber}`);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  drawHeader(
    doc,
    {
      name: institute.legalName || institute.name,
      lines: [institute.address, [institute.phone, institute.email].filter(Boolean).join(' · '), institute.taxId ? `GSTIN ${institute.taxId}` : null].filter(
        (line): line is string => !!line,
      ),
    },
    isRefund ? 'REFUND VOUCHER' : 'PAYMENT RECEIPT',
    [`No. ${payment.receiptNumber}`, `Date ${formatDateOnly(payment.paymentDate, institute.locale)}`],
  );

  if (payment.status === 'reversed') {
    doc.save();
    doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Inter-SemiBold').fontSize(80).fillColor(PDF_COLORS.danger).opacity(0.12);
    doc.text('REVERSED', 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center' });
    doc.restore();
    doc.opacity(1);
  }

  // Party block
  doc.font('Inter').fontSize(9).fillColor(PDF_COLORS.subtle).text(isRefund ? 'Refunded to' : 'Received with thanks from', left, doc.y);
  doc.font('Inter-SemiBold').fontSize(13).fillColor(PDF_COLORS.ink).text(payment.studentName);
  doc.font('Inter').fontSize(9).fillColor(PDF_COLORS.muted).text(`Student ${payment.studentCode} · Admission ${payment.admissionNumber} · ${payment.courseName}`);
  doc.y += 12;

  // Amount box
  const boxTop = doc.y;
  doc.roundedRect(left, boxTop, width, 62, 6).fillAndStroke(PDF_COLORS.band, PDF_COLORS.rule);
  doc.font('Inter').fontSize(9).fillColor(PDF_COLORS.subtle).text('Amount', left + 14, boxTop + 10);
  doc.font('Inter-SemiBold').fontSize(20).fillColor(PDF_COLORS.ink).text(money(payment.amountMinor), left + 14, boxTop + 22);
  doc.font('Inter').fontSize(8.5).fillColor(PDF_COLORS.muted).text(receipt.amountInWords, left + width * 0.42, boxTop + 26, { width: width * 0.55, align: 'right' });
  doc.y = boxTop + 76;
  doc.x = left;

  drawTable(
    doc,
    [
      { header: 'Method', width: width * 0.25 },
      { header: 'Reference', width: width * 0.3 },
      { header: 'Type', width: width * 0.2 },
      { header: 'Recorded by', width: width * 0.25 },
    ],
    [[label(payment.method), payment.referenceNumber ?? '—', label(payment.paymentType), payment.recordedByName ?? '—']],
  );

  if (!isRefund && payment.allocations.length) {
    doc.font('Inter-SemiBold').fontSize(10).fillColor(PDF_COLORS.ink).text('Applied to', left, doc.y);
    doc.y += 4;
    drawTable(
      doc,
      [
        { header: 'Instalment', width: width * 0.4 },
        { header: 'Due date', width: width * 0.3 },
        { header: 'Amount', width: width * 0.3, align: 'right' },
      ],
      payment.allocations.map((a) => [
        a.instalmentSequence ? `Instalment ${a.instalmentSequence}` : 'Course fee (unscheduled)',
        a.instalmentDueDate ? formatDateOnly(a.instalmentDueDate, institute.locale) : '—',
        money(a.amountMinor),
      ]),
      { zebra: true },
    );
  }

  drawTable(
    doc,
    [
      { header: 'Agreed fee', width: width / 3, align: 'right' },
      { header: 'Received to date', width: width / 3, align: 'right' },
      { header: 'Balance due', width: width / 3, align: 'right' },
    ],
    [[money(receipt.agreedFeeMinor), money(receipt.totalReceivedMinor), money(receipt.balanceAfterMinor)]],
    { boldLastRow: true },
  );

  if (payment.status === 'reversed') {
    doc.font('Inter-SemiBold').fontSize(9.5).fillColor(PDF_COLORS.danger).text(`This receipt was reversed: ${payment.reversalReason ?? ''}`, left, doc.y);
    doc.y += 6;
  }
  if (payment.notes) {
    doc.font('Inter').fontSize(9).fillColor(PDF_COLORS.muted).text(`Note: ${payment.notes}`, left, doc.y, { width });
  }

  const stamp = new Intl.DateTimeFormat(institute.locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(generatedAt);
  stampFooters(doc, `Computer-generated ${isRefund ? 'voucher' : 'receipt'}; no signature required. Generated ${stamp}.`);
  return await toBuffer(doc);
}
