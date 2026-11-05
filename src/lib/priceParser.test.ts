import { describe, expect, it } from 'vitest';
import { findPriceCandidates, guessName, looksLikePromo, restoreRaisedCents } from './priceParser';

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

describe('shelf tags with barcodes, case counts and raised centavos', () => {
  const pick = (lines: { text: string; height?: number }[], ctx = {}) => findPriceCandidates(lines, 4, ctx).map((c) => c.centavos / 100);

  it('reads raised centavos run into the pesos ("P4500" for ₱45⁰⁰) as ₱45.00 first', () => {
    expect(pick([{ text: 'CENTURY TUNA FLAKES 155G', height: 20 }, { text: 'P4500', height: 60 }])).toEqual([45, 4500]);
    expect(pick([{ text: '3500', height: 60 }])[0]).toBe(35);
  });

  it('keeps a 3-digit whole peso price first ("P150")', () => {
    expect(pick([{ text: 'P150', height: 60 }])).toEqual([150, 1.5]);
  });

  it('never offers UPC or EAN digit groups printed on the tag', () => {
    expect(pick([{ text: '7 48485 10004 3', height: 70 }, { text: 'P98.00', height: 40 }])).toEqual([98]);
    expect(pick([{ text: '4 800163 443036', height: 70 }])).toEqual([]);
  });

  it('drops groups of the scanned barcode however OCR split them', () => {
    expect(pick([{ text: '74848 510004 3', height: 70 }, { text: 'P98.00', height: 40 }], { barcode: '748485100043' })).toEqual([98]);
  });

  it('ignores case-pack counts', () => {
    for (const text of ['48/CS', '24/box', 'CS 48', 'x 24', '24 x']) expect(pick([{ text, height: 60 }])).toEqual([]);
  });

  it('puts the unit price above the case total', () => {
    expect(pick([{ text: '12 x 35.00 = 420.00', height: 30 }])).toEqual([35, 420]);
    expect(pick([{ text: 'CASE P1,680.00', height: 30 }, { text: 'P35.00', height: 30 }])[0]).toBe(35);
  });

  it("doesn't read a date as a bundle", () => {
    expect(findPriceCandidates([{ text: '11/04/26' }]).filter((c) => c.bundleQty)).toEqual([]);
    expect(findPriceCandidates([{ text: '3 for P100' }])[0]).toMatchObject({ bundleQty: 3, centavos: 10000 });
  });

  it('ranks the option nearest a known price first', () => {
    // A 4-digit whole price is normally second, but not when the product last cost ₱1,480.
    expect(pick([{ text: 'P1500', height: 60 }], { referenceCentavos: 148000 })[0]).toBe(1500);
    expect(pick([{ text: 'P4500', height: 60 }], { referenceCentavos: 4400 })[0]).toBe(45);
  });
});

describe('restoreRaisedCents', () => {
  const sym = (text: string, y0: number, y1: number) => ({ text, bbox: { y0, y1 } });
  it('adds the decimal point when the last two digits are small and raised', () => {
    // "P45⁰⁰": P and 45 are 60 px tall, the 00 is 28 px tall and sits at the top.
    expect(restoreRaisedCents('P4500', [sym('P', 10, 70), sym('4', 10, 70), sym('5', 10, 70), sym('0', 10, 38), sym('0', 10, 38)])).toBe('P45.00');
  });
  it('leaves same-size digits alone', () => {
    expect(restoreRaisedCents('1500', [sym('1', 10, 70), sym('5', 10, 70), sym('0', 10, 70), sym('0', 10, 70)])).toBe('1500');
  });
  it('leaves small digits on the baseline alone (a subscript, not centavos)', () => {
    expect(restoreRaisedCents('4500', [sym('4', 10, 70), sym('5', 10, 70), sym('0', 42, 70), sym('0', 42, 70)])).toBe('4500');
  });
  it('leaves words that already have a decimal, or no boxes', () => {
    expect(restoreRaisedCents('45.00', [])).toBe('45.00');
    expect(restoreRaisedCents('4500', [])).toBe('4500');
  });
});
