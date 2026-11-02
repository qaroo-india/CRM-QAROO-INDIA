/**
 * Amounts in words for receipts, in the Indian numbering system:
 * 12500050 paise -> "Rupees One Lakh Twenty-Five Thousand and Fifty Paise Only".
 */

import { assertMinor } from './money';

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = TENS[Math.floor(n / 10)]!;
  const ones = n % 10;
  return ones ? `${tens}-${ONES[ones]}` : tens;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(belowHundred(rest));
  return parts.join(' ');
}

/** Whole number in Indian groupings: crore, lakh, thousand, hundred. */
export function integerToIndianWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`cannot spell ${value}`);
  if (value === 0) return 'Zero';

  const parts: string[] = [];
  let n = value;
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;

  // Amounts of 100 crore and more read as "<n> Crore", spelling n recursively.
  if (crore) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** Minor units (paise) -> "Rupees ... and ... Paise Only". */
export function amountInWords(minor: number, currencyName = 'Rupees', minorName = 'Paise'): string {
  assertMinor(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 100);
  const fraction = abs % 100;

  const words = [`${currencyName} ${integerToIndianWords(major)}`];
  if (fraction) words.push(`and ${belowHundred(fraction)} ${minorName}`);
  return `${negative ? 'Minus ' : ''}${words.join(' ')} Only`;
}
