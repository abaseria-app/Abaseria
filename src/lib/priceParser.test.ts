import { describe, expect, it } from 'vitest';
import { findPriceCandidates, guessName, looksLikePromo } from './priceParser';

const top = (text: string) => findPriceCandidates([{ text }])[0];
const all = (text: string) => findPriceCandidates([{ text }]).map((c) => c.centavos);

describe('findPriceCandidates: single strings', () => {
  const cases: Array<[string, number]> = [
    ['₱115.00', 11500],
    ['P115.00', 11500],
    ['PHP 1,150.00', 115000],
    ['Php115', 11500],
    ['115.00', 11500],
    ['P1l5.00', 11500],
    ['F 89.75', 8975],
    ['P 1O5.5O', 10550],
    ['SHAMPOO 180ML P189.00', 18900],
    ['₱ 49.25', 4925],
    ['115,00', 11500],
    ['p 24.50', 2450],
  ];
  for (const [text, expected] of cases) {
    it(`reads "${text}" as ${expected}`, () => {
      expect(top(text)?.centavos).toBe(expected);
    });
  }

  it('marks a currency marker', () => {
    expect(top('P115.00')?.hasMarker).toBe(true);
    expect(top('115.00')?.hasMarker).toBe(false);
  });

  it('detects /kg and /100g unit hints', () => {
    expect(top('₱320.00 /kg')?.unit).toBe('kg');
    expect(top('₱320.00 per kg')?.unit).toBe('kg');
    expect(top('₱45.50/100g')?.unit).toBe('100g');
    expect(top('P12.00 /pc')?.unit).toBe('pc');
    expect(top('P320.00 Ikg')?.unit).toBe('kg'); // slash misread as I
    expect(top('P45.50 l100g')?.unit).toBe('100g');
  });

  it('reads bundle deals', () => {
    const b = top('3 for ₱100');
    expect(b?.bundleQty).toBe(3);
    expect(b?.centavos).toBe(10000);
    expect(top('2/₱99')?.bundleQty).toBe(2);
    expect(top('2/₱99')?.centavos).toBe(9900);
  });

  const nothing = [
    '4800016644115', // barcode
    'SKU 12345', // SKU
    'Item No. 445566',
    '10/31/2026', // date
    '2026-10-31',
    'LUCKY ME PANCIT CANTON 60G', // size, no price
    '250ML',
    'Exp 2026', // year
    '₱75,000.00', // over ₱50,000
    'Qty 3', // a lone count
    'SHAMPOO',
  ];
  for (const text of nothing) {
    it(`finds no price in "${text}"`, () => {
      expect(all(text)).toEqual([]);
    });
  }
});

describe('findPriceCandidates: ranking across lines', () => {
  it('puts the biggest text first', () => {
    const c = findPriceCandidates([
      { text: 'REG P129.00', height: 20 },
      { text: 'P99.00', height: 64 },
      { text: '4800016644115', height: 18 },
    ]);
    expect(c.map((x) => x.centavos)).toEqual([9900, 12900]);
  });

  it('ranks a marked price above a bare number of similar size', () => {
    const c = findPriceCandidates([
      { text: '89.75', height: 40 },
      { text: 'P92.50', height: 40 },
    ]);
    expect(c[0].centavos).toBe(9250);
  });

  it('pushes per-100g prices below the selling price', () => {
    const c = findPriceCandidates([
      { text: 'P45.50/100g', height: 30 },
      { text: 'P182.00', height: 30 },
    ]);
    expect(c[0].centavos).toBe(18200);
  });

  it('returns at most 4 and dedupes', () => {
    const c = findPriceCandidates([
      { text: 'P10.00 P20.00 P30.00 P40.00 P50.00' },
      { text: 'P10.00' },
    ]);
    expect(c).toHaveLength(4);
    expect(new Set(c.map((x) => x.centavos)).size).toBe(4);
  });
});

describe('guessName', () => {
  it('picks the description line', () => {
    expect(
      guessName([
        { text: 'SALE' },
        { text: 'LUCKY ME PANCIT CANTON 60G' },
        { text: 'P15.75' },
        { text: '4800016644115' },
      ]),
    ).toBe('Lucky Me Pancit Canton 60g');
  });
  it('returns null when nothing looks like a name', () => {
    expect(guessName([{ text: 'P15.75' }, { text: '123456' }])).toBeNull();
  });
});

describe('looksLikePromo', () => {
  it('spots promo words', () => {
    expect(looksLikePromo([{ text: 'SAVE P10' }])).toBe(true);
    expect(looksLikePromo([{ text: 'Joy Lemon 250ml' }])).toBe(false);
  });
});
