/**
 * Course completion certificate (A4 landscape). Carries a reference number
 * that anyone can check at the institute's public verification page.
 */

import { formatDateOnly, type InstituteInfo } from '@ims/shared';
import { createDocument, PDF_COLORS, toBuffer } from './document';

export interface CertificateData {
  referenceNumber: string;
  studentName: string;
  studentCode: string;
  courseName: string;
  admissionDate: string;
  completedOn: string | null;
  issuedOn: string;
  verifyUrl: string;
}

export async function renderCertificatePdf(data: CertificateData, institute: InstituteInfo): Promise<Buffer> {
  const doc = createDocument(`Certificate ${data.referenceNumber}`, { landscape: true });
  const w = doc.page.width;
  const h = doc.page.height;
  const day = (d: string | null) => formatDateOnly(d, institute.locale);

  // Double frame
  doc.lineWidth(2).strokeColor(PDF_COLORS.accent).rect(24, 24, w - 48, h - 48).stroke();
  doc.lineWidth(0.6).strokeColor(PDF_COLORS.rule).rect(32, 32, w - 64, h - 64).stroke();

  const centre = (text: string, y: number, font: string, size: number, color: string) => {
    doc.font(font).fontSize(size).fillColor(color).text(text, 60, y, { width: w - 120, align: 'center' });
  };

  centre(institute.legalName || institute.name, 70, 'Inter-SemiBold', 18, PDF_COLORS.ink);
  if (institute.address) centre(institute.address, 94, 'Inter', 9, PDF_COLORS.muted);
  centre('CERTIFICATE OF COMPLETION', 140, 'Inter-SemiBold', 26, PDF_COLORS.accent);
  centre('This is to certify that', 196, 'Inter', 12, PDF_COLORS.muted);
  centre(data.studentName, 220, 'Inter-SemiBold', 30, PDF_COLORS.ink);
  centre(`Student ID ${data.studentCode}`, 262, 'Inter', 10, PDF_COLORS.subtle);
  centre('has successfully completed the course', 292, 'Inter', 12, PDF_COLORS.muted);
  centre(data.courseName, 314, 'Inter-SemiBold', 20, PDF_COLORS.ink);
  centre(`Enrolled ${day(data.admissionDate)}${data.completedOn ? ` · Completed ${day(data.completedOn)}` : ''}`, 346, 'Inter', 10, PDF_COLORS.muted);

  // Footer: issue date and signature line on the left; reference on the right.
  const footY = h - 140;
  doc.font('Inter').fontSize(10).fillColor(PDF_COLORS.ink).text(`Issued on ${day(data.issuedOn)}`, 80, footY);
  doc.moveTo(80, footY + 50).lineTo(300, footY + 50).lineWidth(0.8).strokeColor(PDF_COLORS.muted).stroke();
  doc.font('Inter').fontSize(9).fillColor(PDF_COLORS.muted).text('Authorised signatory', 80, footY + 56);

  doc.font('Inter-SemiBold').fontSize(10).fillColor(PDF_COLORS.ink).text(`Reference ${data.referenceNumber}`, w - 380, footY, { width: 300, align: 'right' });
  doc.font('Inter').fontSize(8.5).fillColor(PDF_COLORS.muted).text(`Verify at ${data.verifyUrl}`, w - 380, footY + 16, { width: 300, align: 'right' });

  return toBuffer(doc);
}
