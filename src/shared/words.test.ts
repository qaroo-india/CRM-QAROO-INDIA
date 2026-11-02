import { describe, expect, it } from 'vitest';
import { amountInWords, integerToIndianWords } from './words';

describe('integerToIndianWords', () => {
  it('spells small numbers', () => {
    expect(integerToIndianWords(0)).toBe('Zero');
    expect(integerToIndianWords(7)).toBe('Seven');
    expect(integerToIndianWords(19)).toBe('Nineteen');
    expect(integerToIndianWords(45)).toBe('Forty-Five');
    expect(integerToIndianWords(100)).toBe('One Hundred');
    expect(integerToIndianWords(999)).toBe('Nine Hundred Ninety-Nine');
  });

  it('uses lakh and crore groupings', () => {
    expect(integerToIndianWords(12_500)).toBe('Twelve Thousand Five Hundred');
    expect(integerToIndianWords(1_25_000)).toBe('One Lakh Twenty-Five Thousand');
    expect(integerToIndianWords(99_99_999)).toBe('Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine');
    expect(integerToIndianWords(1_00_00_000)).toBe('One Crore');
    expect(integerToIndianWords(2_35_40_001)).toBe('Two Crore Thirty-Five Lakh Forty Thousand One');
  });
});

describe('amountInWords', () => {
  it('writes rupees and paise for receipts', () => {
    expect(amountInWords(12_500_050)).toBe('Rupees One Lakh Twenty-Five Thousand and Fifty Paise Only');
    expect(amountInWords(100)).toBe('Rupees One Only');
    expect(amountInWords(5)).toBe('Rupees Zero and Five Paise Only');
  });
});
