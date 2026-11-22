// Product size as shoppers enter it on the item screen, written the way the products table already stores
// sizes: compact, no space. "500g", "1kg", "250ml", "1.5L", "13.5oz", "10pcs", and multipacks as "4x113g".
// Fluid ounces keep their spaces, "20 fl oz", as the imported products already write them.
// search.ts reads these back (parseSize finds "113g" inside "4x113g"), so search and recipes keep working.

export type SizeUnit = 'g' | 'kg' | 'ml' | 'L' | 'oz' | 'fl oz' | 'pcs';
export const SIZE_UNITS: SizeUnit[] = ['g', 'kg', 'ml', 'L', 'oz', 'fl oz', 'pcs'];

export interface SizeParts {
  /** As typed, e.g. "1.5". */
  amount: string;
  unit: SizeUnit;
  /** Pieces in a multipack under one barcode. 1 for a single item. */
  pack: number;
}

/** The products table allows 40 characters; these stay far under it. */
const MAX_AMOUNT = 100_000;
const MAX_PACK = 999;

/** "1.50" → 1.5, "1,5" → 1.5. Null unless it's a positive number in range. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(t) && !/^\.\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= MAX_AMOUNT ? n : null;
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** "1.5" L → "1.5L". 4 × 113 g → "4x113g". Null when the amount isn't usable or pcs has a fraction. */
export function formatSize(parts: SizeParts): string | null {
  const n = parseAmount(parts.amount);
  if (n == null) return null;
  if (parts.unit === 'pcs' && !Number.isInteger(n)) return null;
  const pack = Math.floor(parts.pack);
  if (!(pack >= 1 && pack <= MAX_PACK)) return null;
  const one = parts.unit === 'fl oz' ? `${num(n)} fl oz` : `${num(n)}${parts.unit}`;
  return pack > 1 ? `${pack}x${one}` : one;
}

const UNIT_WORDS: Record<string, [SizeUnit, number]> = {
  g: ['g', 1], gm: ['g', 1], gms: ['g', 1], gr: ['g', 1], grs: ['g', 1], gram: ['g', 1], grams: ['g', 1],
  kg: ['kg', 1], kgs: ['kg', 1], kilo: ['kg', 1], kilos: ['kg', 1],
  ml: ['ml', 1], cl: ['ml', 10],
  // Ounces stay ounces: what's printed on the pack is what the shopper checks against.
  oz: ['oz', 1], ozs: ['oz', 1], floz: ['fl oz', 1],
  l: ['L', 1], li: ['L', 1], ltr: ['L', 1], liter: ['L', 1], liters: ['L', 1], litre: ['L', 1], litres: ['L', 1],
  pc: ['pcs', 1], pcs: ['pcs', 1], piece: ['pcs', 1], pieces: ['pcs', 1], ct: ['pcs', 1], s: ['pcs', 1],
};
// "fl oz", "fl. oz" and "floz" before plain "oz", so liquids aren't read as weight.
const WORDS = ['fl\\.?\\s*oz', ...Object.keys(UNIT_WORDS).filter((k) => k !== 'floz').sort((a, b) => b.length - a.length)].join('|');
const AMOUNT = '(\\d{1,6}(?:[.,]\\d{1,3})?)';
const MULTI = new RegExp(`(?<![\\d.])(\\d{1,3})\\s*[x×]\\s*${AMOUNT}\\s*(${WORDS})(?![a-z])`, 'i');
const SINGLE = new RegExp(`(?<![\\d.])${AMOUNT}\\s*(${WORDS})(?![a-z])`, 'i');

/**
 * The first size printed in a text, as form values: "JOY LEMON 250ML" → 250 ml, "Nissin 4 x 55g" → 4 × 55 g.
 * Used to pre-fill the size from the shelf tag or the name. "13.5oz (384g)" → 13.5 oz, the first size printed.
 */
export function guessSize(text: string | null | undefined): SizeParts | null {
  if (!text) return null;
  const m = text.match(MULTI);
  if (m) {
    const parts = toParts(m[2], m[3], Number(m[1]));
    if (parts) return parts;
  }
  const s = text.match(SINGLE);
  return s ? toParts(s[1], s[2], 1) : null;
}

function toParts(amount: string, word: string, pack: number): SizeParts | null {
  const u = UNIT_WORDS[word.toLowerCase().replace(/[.\s]/g, '')];
  const n = parseAmount(amount);
  // "s" alone is only a count after a whole number, as in "50s".
  if (!u || n == null || (u[0] === 'pcs' && !Number.isInteger(n))) return null;
  const parts: SizeParts = { amount: num(n * u[1]), unit: u[0], pack: pack >= 1 && pack <= MAX_PACK ? pack : 1 };
  return formatSize(parts) ? parts : null;
}
