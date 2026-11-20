import { describe, expect, it } from 'vitest';
import { formatSize, guessSize, parseAmount } from './size';
import { parseSize } from './search';

describe('formatSize', () => {
  it('writes sizes the way the products table already stores them', () => {
    expect(formatSize({ amount: '500', unit: 'g', pack: 1 })).toBe('500g');
    expect(formatSize({ amount: '1.50', unit: 'L', pack: 1 })).toBe('1.5L');
    expect(formatSize({ amount: '1,5', unit: 'L', pack: 1 })).toBe('1.5L');
    expect(formatSize({ amount: '10', unit: 'pcs', pack: 1 })).toBe('10pcs');
    expect(formatSize({ amount: '113', unit: 'g', pack: 4 })).toBe('4x113g');
  });

  it('refuses amounts that make no sense', () => {
    expect(formatSize({ amount: '', unit: 'g', pack: 1 })).toBeNull();
    expect(formatSize({ amount: '0', unit: 'g', pack: 1 })).toBeNull();
    expect(formatSize({ amount: 'abc', unit: 'ml', pack: 1 })).toBeNull();
    expect(formatSize({ amount: '2.5', unit: 'pcs', pack: 1 })).toBeNull();
    expect(formatSize({ amount: '9999999', unit: 'g', pack: 1 })).toBeNull();
    expect(formatSize({ amount: '100', unit: 'g', pack: 0 })).toBeNull();
  });

  it('stays readable by search, so "1L" still finds "1000ml" and multipacks match their piece', () => {
    expect(parseSize(formatSize({ amount: '1.5', unit: 'L', pack: 1 }))).toEqual({ kind: 'volume', amount: 1500 });
    expect(parseSize(formatSize({ amount: '113', unit: 'g', pack: 4 }))).toEqual({ kind: 'mass', amount: 113 });
    expect(parseSize(formatSize({ amount: '10', unit: 'pcs', pack: 1 }))).toEqual({ kind: 'count', amount: 10 });
  });

  it('fits the 40-character limit in the database', () => {
    expect(formatSize({ amount: '99999.999', unit: 'pcs', pack: 999 }) ?? '').toHaveLength(0);
    expect((formatSize({ amount: '99999.999', unit: 'ml', pack: 999 }) ?? '').length).toBeLessThanOrEqual(40);
  });
});

describe('guessSize', () => {
  it('reads the size off a shelf tag or a typed name', () => {
    expect(guessSize('JOY LEMON 250ML')).toEqual({ amount: '250', unit: 'ml', pack: 1 });
    expect(guessSize('Coke 1.5 L')).toEqual({ amount: '1.5', unit: 'L', pack: 1 });
    expect(guessSize('Rice 25 kgs')).toEqual({ amount: '25', unit: 'kg', pack: 1 });
    expect(guessSize('Sardines 155g')).toEqual({ amount: '155', unit: 'g', pack: 1 });
    expect(guessSize('Wine 75cl')).toEqual({ amount: '750', unit: 'ml', pack: 1 });
    expect(guessSize('Eggs 12pcs')).toEqual({ amount: '12', unit: 'pcs', pack: 1 });
    expect(guessSize('Tissue 50s')).toEqual({ amount: '50', unit: 'pcs', pack: 1 });
  });

  it('keeps multipacks together', () => {
    expect(guessSize('Lucky Me 4 x 55g')).toEqual({ amount: '55', unit: 'g', pack: 4 });
    expect(guessSize('Nescafe 3in1 10×20g')).toEqual({ amount: '20', unit: 'g', pack: 10 });
  });

  it('leaves out prices, codes and words that only look like units', () => {
    expect(guessSize('₱115.00')).toBeNull();
    expect(guessSize('Gardenia Classic')).toBeNull();
    expect(guessSize('Item 4800016644818')).toBeNull();
    expect(guessSize('Peanut butter 16oz')).toBeNull();
    expect(guessSize('Glass 2 large')).toBeNull();
    expect(guessSize(null)).toBeNull();
  });
});

describe('parseAmount', () => {
  it('accepts a leading dot and a comma', () => {
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('0,75')).toBe(0.75);
    expect(parseAmount('1.2.3')).toBeNull();
  });
});
