// All money is stored as integer centavos. Never floats.

export type PriceType = 'each' | 'bundle' | 'perkg';

const fmt = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123450 -> "₱1,234.50" */
export function formatPeso(centavos: number): string {
  const sign = centavos < 0 ? '-' : '';
  return `${sign}₱${fmt.format(Math.abs(centavos) / 100)}`;
}

/** Parses what a person typed ("1,234.5", "₱89", "89.75") into centavos. Returns null if it isn't a usable amount. */
export function parsePesoInput(input: string): number | null {
  const cleaned = input.replace(/[₱\s,]/g, '').replace(/^(php|p)/i, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const centavos = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

export interface LineInput {
  priceType: PriceType;
  /** each: price per item. bundle: unused for the math, kept for display. perkg: price per kilo. */
  unitPriceCentavos: number;
  quantity: number;
  bundleQty?: number | null;
  bundlePriceCentavos?: number | null;
  /** perkg only: amount bought, in grams. */
  weightGrams?: number | null;
}

/**
 * each:   unit price × quantity
 * perkg:  price per kilo × weight, rounded to the centavo. ₱320/kg × 0.75 kg = ₱240.00
 * bundle: whole bundles at the bundle price, plus leftover units at bundle_price / bundle_qty (rounded to the centavo).
 *         "3 for ₱100" × 4 = ₱100 + ₱33.33 = ₱133.33
 */
export function lineTotal(input: LineInput): number {
  if (input.priceType === 'perkg') return Math.round((input.unitPriceCentavos * Math.max(0, input.weightGrams ?? 0)) / 1000);
  const qty = Math.max(0, Math.floor(input.quantity));
  if (input.priceType === 'bundle' && input.bundleQty && input.bundleQty > 0 && input.bundlePriceCentavos != null) {
    const bundles = Math.floor(qty / input.bundleQty);
    const leftover = qty % input.bundleQty;
    return bundles * input.bundlePriceCentavos + Math.round((leftover * input.bundlePriceCentavos) / input.bundleQty);
  }
  return input.unitPriceCentavos * qty;
}

const FRACTIONS: Record<string, number> = { '1/4': 0.25, '1/2': 0.5, '3/4': 0.75, '1/3': 1 / 3, '2/3': 2 / 3 };

/**
 * What a person typed for a weight, in grams. Kilos by default: "0.75", ".5", "1.25 kg", "1/2", "1 1/2".
 * Grams when marked: "750g", "750 g". Returns null outside 1 g to 50 kg or when it can't be read.
 */
export function parseKgInput(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ');
  let grams: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+(?:\.\d+)?) ?(g|gram|grams)$/))) grams = Number(m[1]);
  else if ((m = s.match(/^(\d*\.?\d+) ?(kg|kilo|kilos)?$/))) grams = Number(m[1]) * 1000;
  else if ((m = s.match(/^(?:(\d+) )?(\d\/\d) ?(kg|kilo|kilos)?$/)) && FRACTIONS[m[2]] != null) grams = (Number(m[1] ?? 0) + FRACTIONS[m[2]]) * 1000;
  if (grams == null || !Number.isFinite(grams)) return null;
  const g = Math.round(grams);
  return g >= 1 && g <= 50_000 ? g : null;
}

/** 750 -> "0.75 kg", 1500 -> "1.5 kg", 1000 -> "1 kg" */
export function formatKg(grams: number): string {
  return `${Number((grams / 1000).toFixed(3))} kg`;
}
