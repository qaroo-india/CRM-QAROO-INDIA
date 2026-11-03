/**
 * PDF building blocks shared by receipts and reports.
 *
 * Inter is embedded (server/assets/fonts) because PDFKit's built-in
 * Helvetica has no rupee glyph; a receipt must print "₹", not a box.
 * The production bundle carries the font files inside it (scripts/build.mjs),
 * so a serverless function needs no font files on disk.
 * Documents buffer their pages so page numbers ("Page 2 of 5") can be
 * stamped once the final page count is known.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { serverPath } from '../config/paths';

const FONT_DIR = serverPath('assets', 'fonts');

/** Base64 font files, set by scripts/build.mjs; undefined when running from source. */
declare const __EMBEDDED_FONTS__: { regular: string; semiBold: string } | undefined;

let fonts: { regular: Buffer | string; semiBold: Buffer | string } | null = null;

function interFonts() {
  fonts ??=
    typeof __EMBEDDED_FONTS__ === 'undefined'
      ? { regular: resolve(FONT_DIR, 'Inter_400Regular.ttf'), semiBold: resolve(FONT_DIR, 'Inter_600SemiBold.ttf') }
      : { regular: Buffer.from(__EMBEDDED_FONTS__.regular, 'base64'), semiBold: Buffer.from(__EMBEDDED_FONTS__.semiBold, 'base64') };
  return fonts;
}

export const PDF_COLORS = {
  ink: '#0f172a',
  muted: '#475569',
  subtle: '#64748b',
  rule: '#d9dfe6',
  band: '#f4f7fb',
  accent: '#2a78d6',
  danger: '#c62828',
  success: '#1b7f3b',
} as const;

export type Doc = InstanceType<typeof PDFDocument>;

export function createDocument(title: string, options: { landscape?: boolean } = {}): Doc {
  const doc = new PDFDocument({
    size: 'A4',
    layout: options.landscape ? 'landscape' : 'portrait',
    margins: { top: 48, bottom: 56, left: 48, right: 48 },
    bufferPages: true,
    info: { Title: title, Author: 'Qaroo India Private Limited', Creator: 'Qaroo India Private Limited' },
  });
  doc.registerFont('Inter', interFonts().regular);
  doc.registerFont('Inter-SemiBold', interFonts().semiBold);
  doc.font('Inter').fontSize(10).fillColor(PDF_COLORS.ink);
  return doc;
}

/** Finish the document and collect it into one Buffer. */
export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Stamp "Page n of N" and a footer line on every buffered page. */
export function stampFooters(doc: Doc, footerText: string): void {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing inside the margin must not add a page
    const y = doc.page.height - 36;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.font('Inter').fontSize(8).fillColor(PDF_COLORS.subtle);
    doc.text(footerText, doc.page.margins.left, y, { width, align: 'left', lineBreak: false });
    doc.text(`Page ${index - range.start + 1} of ${range.count}`, doc.page.margins.left, y, { width, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

export interface InstituteHeader {
  name: string;
  lines: string[];
}

/** Institute identity on the left, a document title block on the right. */
export function drawHeader(doc: Doc, institute: InstituteHeader, title: string, meta: string[]): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  let top = doc.y;

  const logoPath = resolve('public/logo.png');
  if (existsSync(logoPath)) {
    try {
      doc.image(logoPath, left, top, { width: 130 });
      top += 38;
      doc.y = top;
    } catch {
      // Continue without image if format unsupported
    }
  }

  doc.font('Inter-SemiBold').fontSize(16).fillColor(PDF_COLORS.ink).text(institute.name, left, top, { width: width * 0.6 });
  doc.font('Inter').fontSize(8.5).fillColor(PDF_COLORS.muted);
  for (const line of institute.lines) doc.text(line, { width: width * 0.6 });
  const leftBottom = doc.y;

  doc.font('Inter-SemiBold').fontSize(13).fillColor(PDF_COLORS.accent).text(title, left + width * 0.6, top, { width: width * 0.4, align: 'right' });
  doc.font('Inter').fontSize(9).fillColor(PDF_COLORS.muted);
  for (const line of meta) doc.text(line, left + width * 0.6, doc.y, { width: width * 0.4, align: 'right' });

  doc.y = Math.max(leftBottom, doc.y) + 10;
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1).strokeColor(PDF_COLORS.accent).stroke();
  doc.y += 14;
  doc.x = left;
}

export interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

/**
 * A simple paginating table: rows that would cross the bottom margin start a
 * new page, and the header row repeats on every page.
 */
export function drawTable(doc: Doc, columns: TableColumn[], rows: string[][], options: { zebra?: boolean; boldLastRow?: boolean } = {}): void {
  const left = doc.page.margins.left;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);
  const padX = 6;
  const padY = 5;

  const rowHeight = (cells: string[], font: string, size: number) => {
    doc.font(font).fontSize(size);
    return Math.max(...cells.map((cell, i) => doc.heightOfString(cell || ' ', { width: columns[i]!.width - padX * 2 }))) + padY * 2;
  };

  const drawRow = (cells: string[], y: number, height: number, font: string, size: number, color: string) => {
    let x = left;
    doc.font(font).fontSize(size).fillColor(color);
    cells.forEach((cell, i) => {
      const col = columns[i]!;
      doc.text(cell, x + padX, y + padY, { width: col.width - padX * 2, align: col.align ?? 'left' });
      x += col.width;
    });
  };

  const drawHeaderRow = () => {
    const height = rowHeight(columns.map((c) => c.header), 'Inter-SemiBold', 8);
    const y = doc.y;
    doc.rect(left, y, totalWidth, height).fill(PDF_COLORS.band);
    drawRow(columns.map((c) => c.header.toUpperCase()), y, height, 'Inter-SemiBold', 8, PDF_COLORS.muted);
    doc.y = y + height;
  };

  drawHeaderRow();
  rows.forEach((cells, index) => {
    const last = index === rows.length - 1;
    const font = options.boldLastRow && last ? 'Inter-SemiBold' : 'Inter';
    const height = rowHeight(cells, font, 9);
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeaderRow();
    }
    const y = doc.y;
    if (options.zebra && index % 2 === 1) doc.rect(left, y, totalWidth, height).fill('#fafbfd');
    drawRow(cells, y, height, font, 9, PDF_COLORS.ink);
    doc.moveTo(left, y + height).lineTo(left + totalWidth, y + height).lineWidth(0.5).strokeColor(PDF_COLORS.rule).stroke();
    doc.y = y + height;
  });
  doc.x = left;
  doc.y += 8;
}

export function sectionTitle(doc: Doc, text: string): void {
  if (doc.y + 40 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.font('Inter-SemiBold').fontSize(11).fillColor(PDF_COLORS.ink).text(text, doc.page.margins.left, doc.y);
  doc.y += 4;
}
