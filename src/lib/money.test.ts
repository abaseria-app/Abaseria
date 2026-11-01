import { describe, expect, it } from 'vitest';
import { formatKg, formatPeso, lineTotal, parseKgInput, parsePesoInput } from './money';

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


describe('per-kilo items', () => {
  it('multiplies price per kilo by weight, rounded to the centavo', () => {
    expect(lineTotal({ priceType: 'perkg', unitPriceCentavos: 32000, quantity: 1, weightGrams: 750 })).toBe(24000);
    expect(lineTotal({ priceType: 'perkg', unitPriceCentavos: 18950, quantity: 1, weightGrams: 1234 })).toBe(23384);
    expect(lineTotal({ priceType: 'perkg', unitPriceCentavos: 32000, quantity: 1, weightGrams: null })).toBe(0);
  });

  it('reads kilos, fractions and grams', () => {
    expect(parseKgInput('0.75')).toBe(750);
    expect(parseKgInput('.5')).toBe(500);
    expect(parseKgInput('1.25 kg')).toBe(1250);
    expect(parseKgInput('1/2')).toBe(500);
    expect(parseKgInput('1 1/2')).toBe(1500);
    expect(parseKgInput('1/4 kilo')).toBe(250);
    expect(parseKgInput('750g')).toBe(750);
    expect(parseKgInput('750 g')).toBe(750);
    expect(parseKgInput('0,5')).toBe(500);
  });

  it('rejects junk and silly weights', () => {
    expect(parseKgInput('')).toBeNull();
    expect(parseKgInput('abc')).toBeNull();
    expect(parseKgInput('0')).toBeNull();
    expect(parseKgInput('80')).toBeNull();
    expect(parseKgInput('5/8')).toBeNull();
  });

  it('formats weights without trailing zeros', () => {
    expect(formatKg(750)).toBe('0.75 kg');
    expect(formatKg(1500)).toBe('1.5 kg');
    expect(formatKg(1000)).toBe('1 kg');
    expect(formatKg(1234)).toBe('1.234 kg');
  });
});
