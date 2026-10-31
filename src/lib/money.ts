// All money is stored as integer centavos. Never floats.

export type PriceType = 'each' | 'bundle';

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
  /** each: price per item. bundle: unused for the math, kept for display. */
  unitPriceCentavos: number;
  quantity: number;
  bundleQty?: number | null;
  bundlePriceCentavos?: number | null;
}

/**
 * each:   unit price × quantity
 * bundle: whole bundles at the bundle price, plus leftover units at bundle_price / bundle_qty (rounded to the centavo).
 *         "3 for ₱100" × 4 = ₱100 + ₱33.33 = ₱133.33
 */
export function lineTotal(input: LineInput): number {
  const qty = Math.max(0, Math.floor(input.quantity));
  if (input.priceType === 'bundle' && input.bundleQty && input.bundleQty > 0 && input.bundlePriceCentavos != null) {
    const bundles = Math.floor(qty / input.bundleQty);
    const leftover = qty % input.bundleQty;
    return bundles * input.bundlePriceCentavos + Math.round((leftover * input.bundlePriceCentavos) / input.bundleQty);
  }
  return input.unitPriceCentavos * qty;
}
