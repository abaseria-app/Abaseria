import { describe, expect, it } from 'vitest';
import { formatPeso, lineTotal, parsePesoInput } from './money';

describe('formatPeso', () => {
  it('formats centavos with peso sign and commas', () => {
    expect(formatPeso(123450)).toBe('₱1,234.50');
    expect(formatPeso(0)).toBe('₱0.00');
    expect(formatPeso(8975)).toBe('₱89.75');
    expect(formatPeso(-500)).toBe('-₱5.00');
  });
});

describe('parsePesoInput', () => {
  it('accepts common typed forms', () => {
    expect(parsePesoInput('89')).toBe(8900);
    expect(parsePesoInput('89.75')).toBe(8975);
    expect(parsePesoInput('89.7')).toBe(8970);
    expect(parsePesoInput('₱1,234.50')).toBe(123450);
    expect(parsePesoInput('P115')).toBe(11500);
  });
  it('rejects junk', () => {
    expect(parsePesoInput('')).toBeNull();
    expect(parsePesoInput('abc')).toBeNull();
    expect(parsePesoInput('1.234')).toBeNull();
  });
});

describe('lineTotal', () => {
  it('each: unit price × quantity', () => {
    expect(lineTotal({ priceType: 'each', unitPriceCentavos: 11500, quantity: 3 })).toBe(34500);
  });
  it('each: quantity 0 is 0', () => {
    expect(lineTotal({ priceType: 'each', unitPriceCentavos: 11500, quantity: 0 })).toBe(0);
  });
  it('bundle: exact multiple', () => {
    expect(lineTotal({ priceType: 'bundle', unitPriceCentavos: 0, quantity: 6, bundleQty: 3, bundlePriceCentavos: 10000 })).toBe(20000);
  });
  it('bundle: leftover units at per-unit bundle price, rounded', () => {
    // 3 for ₱100, buy 4 -> 100 + 33.33
    expect(lineTotal({ priceType: 'bundle', unitPriceCentavos: 0, quantity: 4, bundleQty: 3, bundlePriceCentavos: 10000 })).toBe(13333);
    // 3 for ₱100, buy 2 -> 66.67
    expect(lineTotal({ priceType: 'bundle', unitPriceCentavos: 0, quantity: 2, bundleQty: 3, bundlePriceCentavos: 10000 })).toBe(6667);
  });
  it('bundle: 2 for ₱99, buy 1', () => {
    expect(lineTotal({ priceType: 'bundle', unitPriceCentavos: 0, quantity: 1, bundleQty: 2, bundlePriceCentavos: 9900 })).toBe(4950);
  });
});
