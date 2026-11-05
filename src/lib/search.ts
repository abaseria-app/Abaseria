// Item search: one box that understands names, barcodes, prices and sizes, plus filters and sorting.
//
// What the box understands (all parts must match):
//   coke, pancit canton     words in the name or size, any order, any capitals, ñ = n
//   4800016644115           a barcode, whole or partial (spaces and dashes are ignored); 6+ digits
//   ₱50, p50, php 50        price: ₱50.00 to ₱50.99; "₱45.50" is that exact price
//   under 100, < ₱100       price at most ₱100       over 50, > 50   price at least ₱50
//   ₱20-50, 20 to 50        price range
//   1.5L, 500 g, 330ml      size, in any unit of the same kind: "1L" finds "1000ml"
//   50                      a plain short number: a ₱50 price, a size of 50 (any unit) or "50" in the name
//
// Prices are compared per piece: a bundle "3 for ₱100" counts as ₱33.33, a per-kilo price as its price per kilo.
// Everything here is pure so it can be tested without a phone.
import type { PriceType } from './money';
import { CATEGORY_BY_ID, type CategoryId } from './categories';

// ---------------------------------------------------------------------------------------------------------
// Catalog shape

export interface PricePoint {
  /** One key per store: the store's id in the shared database when known, otherwise a phone-only key. */
  storeKey: string;
  storeLabel: string;
  /** Day the price was seen, YYYY-MM-DD. */
  seenOn: string;
  priceType: PriceType;
  unitPriceCentavos: number;
  bundleQty: number | null;
  bundlePriceCentavos: number | null;
  isPromo: boolean;
  /** 'phone' = logged on this phone. 'shared' = from other shoppers through the shared database. */
  source: 'phone' | 'shared';
}

export interface CatalogItem {
  /** The barcode when there is one, otherwise "name:" plus the lowercased name. */
  key: string;
  barcode: string | null;
  name: string;
  /** As printed on the pack: "1.5L", "80g". Only products in the shared database have one. */
  size: string | null;
  category: CategoryId;
  /** A picture to show: the shrunk copy kept on the phone, or the shared image's web address. */
  image: string | null;
  /** The latest price at each store, newest first. */
  prices: PricePoint[];
}

/** The price of one piece (bundle split evenly) or of one kilo. Used for every comparison. */
export function comparable(p: Pick<PricePoint, 'priceType' | 'unitPriceCentavos' | 'bundleQty' | 'bundlePriceCentavos'>): number {
  if (p.priceType === 'bundle' && p.bundleQty && p.bundlePriceCentavos != null) return Math.round(p.bundlePriceCentavos / p.bundleQty);
  return p.unitPriceCentavos;
}

// ---------------------------------------------------------------------------------------------------------
// Text and size helpers

/** Lowercase, accents off (ñ → n), punctuation to spaces, single spaces. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SizeKind = 'mass' | 'volume' | 'count';
export interface Size {
  kind: SizeKind;
  /** Grams, millilitres or pieces. */
  amount: number;
}

const UNITS: Record<string, [SizeKind, number]> = {
  mg: ['mass', 0.001], g: ['mass', 1], gm: ['mass', 1], gms: ['mass', 1], gr: ['mass', 1], gram: ['mass', 1], grams: ['mass', 1],
  kg: ['mass', 1000], kgs: ['mass', 1000], kilo: ['mass', 1000], kilos: ['mass', 1000], oz: ['mass', 28.3495], lb: ['mass', 453.592], lbs: ['mass', 453.592],
  ml: ['volume', 1], cl: ['volume', 10], l: ['volume', 1000], li: ['volume', 1000], ltr: ['volume', 1000], liter: ['volume', 1000],
  liters: ['volume', 1000], litre: ['volume', 1000], litres: ['volume', 1000],
  pc: ['count', 1], pcs: ['count', 1], piece: ['count', 1], pieces: ['count', 1], s: ['count', 1], pack: ['count', 1], packs: ['count', 1],
  sachet: ['count', 1], sachets: ['count', 1], roll: ['count', 1], rolls: ['count', 1], tabs: ['count', 1], ply: ['count', 1],
};
const UNIT_RE = Object.keys(UNITS).sort((a, b) => b.length - a.length).join('|');
const SIZE_ANYWHERE = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_RE})(?![a-z])`, 'i');

function toSize(num: string, unit: string): Size | null {
  const u = UNITS[unit.toLowerCase()];
  const n = Number(num.replace(',', '.'));
  if (!u || !Number.isFinite(n) || n <= 0) return null;
  return { kind: u[0], amount: n * u[1] };
}

/** The first size printed in a text: "Coke 1.5L" → 1500 ml. "6 x 330ml" → 330 ml (the piece). */
export function parseSize(text: string | null | undefined): Size | null {
  if (!text) return null;
  const m = text.match(SIZE_ANYWHERE);
  return m ? toSize(m[1], m[2]) : null;
}

/** Same kind and within 3%, so "1L" = "1000ml" and "16oz" ≈ "454g". */
export function sameSize(a: Size, b: Size): boolean {
  return a.kind === b.kind && Math.abs(a.amount - b.amount) <= Math.max(a.amount, b.amount) * 0.03;
}

// ---------------------------------------------------------------------------------------------------------
// Reading the search box

export interface PriceRange {
  min: number | null;
  max: number | null;
}

export interface Query {
  /** Words that must each appear in the name or size. */
  words: string[];
  /** Digit strings that must each appear in the barcode. */
  barcodes: string[];
  sizes: Size[];
  /** Plain short numbers: a price, a size amount or part of the name. */
  numbers: number[];
  /** From "₱50", "under 100", "20-50". Centavos. */
  price: PriceRange | null;
  /** True when nothing was typed. */
  empty: boolean;
}

// The "p" of "php"/"p50" only counts at the start of a word, so "soap 20-50" keeps its p.
const PESO = String.raw`(?:₱|(?<![a-z])php|(?<![a-z])p)?\s*`;
const AMT = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`;
const toCentavos = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 100);
/** A number with centavos ("45.50") is exact; a whole one ("50") covers ₱50.00 to ₱50.99. */
const wholePeso = (s: string): PriceRange => {
  const c = toCentavos(s);
  return /\./.test(s) ? { min: c, max: c } : { min: c, max: c + 99 };
};

function mergeRange(a: PriceRange | null, b: PriceRange): PriceRange {
  if (!a) return b;
  return {
    min: a.min == null ? b.min : b.min == null ? a.min : Math.max(a.min, b.min),
    max: a.max == null ? b.max : b.max == null ? a.max : Math.min(a.max, b.max),
  };
}

export function parseQuery(input: string): Query {
  const q: Query = { words: [], barcodes: [], sizes: [], numbers: [], price: null, empty: !input.trim() };
  let s = input.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (!s) return q;

  // A whole barcode, possibly typed the way it's printed: "4 800016 644115", "4800016-644115".
  const digitsOnly = s.replace(/[\s-]/g, '');
  if (/^\d{8,14}$/.test(digitsOnly)) {
    q.barcodes.push(digitsOnly);
    return q;
  }

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    s = s.replace(re, (...args) => {
      fn(args as unknown as RegExpMatchArray);
      return ' ';
    });
  };
  const notUnit = `(?!\\s*(?:${UNIT_RE})(?![a-z]))`;
  take(new RegExp(String.raw`(?:under|below|less than|max|hanggang|<=?)\s*${PESO}${AMT}${notUnit}`, 'g'), (m) => {
    q.price = mergeRange(q.price, { min: null, max: toCentavos(m[1]) });
  });
  take(new RegExp(String.raw`(?:over|above|more than|min|at least|>=?)\s*${PESO}${AMT}${notUnit}`, 'g'), (m) => {
    q.price = mergeRange(q.price, { min: toCentavos(m[1]), max: null });
  });
  take(new RegExp(String.raw`${PESO}${AMT}\s*(?:-|–|to)\s*${PESO}${AMT}${notUnit}`, 'g'), (m) => {
    const [a, b] = [toCentavos(m[1]), toCentavos(m[2])].sort((x, y) => x - y);
    q.price = mergeRange(q.price, { min: a, max: b + (/\./.test(m[2]) ? 0 : 99) });
  });
  // "₱50", "php 50", "p50". A lone "p" must be right before the number so "pack 50" isn't a price.
  take(new RegExp(String.raw`(?:₱\s*|php\s*|(?<![a-z])p)${AMT}${notUnit}`, 'g'), (m) => {
    q.price = mergeRange(q.price, wholePeso(m[1]));
  });
  // "1.5 L" → one size, not "1.5" and "l".
  take(new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*(${UNIT_RE})(?![a-z])`, 'g'), (m) => {
    const size = toSize(m[1], m[2]);
    if (size) q.sizes.push(size);
  });

  for (const raw of fold(s).split(' ')) {
    const t = raw.replace(/^\.+|\.+$/g, '');
    if (!t) continue;
    if (/^\d{6,14}$/.test(t)) q.barcodes.push(t);
    else if (/^\d+(\.\d+)?$/.test(t)) q.numbers.push(Number(t));
    else q.words.push(t);
  }
  return q;
}

// ---------------------------------------------------------------------------------------------------------
// Filters and sorting

export interface Filters {
  /** Empty = every category. */
  categories: CategoryId[];
  /** A storeKey: only prices at that store, and only items with a price there. */
  store: string | null;
  /** Centavos, per piece or per kilo. */
  minCentavos: number | null;
  maxCentavos: number | null;
  /** Only items with a promo price. */
  promoOnly: boolean;
  /** Only items with at least one price. */
  withPrice: boolean;
  /** Only prices seen in the last N days (7 = this week). Null = any time. */
  withinDays: number | null;
}

export const NO_FILTERS: Filters = {
  categories: [],
  store: null,
  minCentavos: null,
  maxCentavos: null,
  promoOnly: false,
  withPrice: false,
  withinDays: null,
};

/** How many filters are switched on, for the badge on the Filters button. */
export function activeFilterCount(f: Filters): number {
  return (
    (f.categories.length ? 1 : 0) +
    (f.store ? 1 : 0) +
    (f.minCentavos != null || f.maxCentavos != null ? 1 : 0) +
    (f.promoOnly ? 1 : 0) +
    (f.withPrice ? 1 : 0) +
    (f.withinDays != null ? 1 : 0)
  );
}

export type SortKey = 'best' | 'name' | 'priceLow' | 'priceHigh' | 'newest';
export const SORT_KEYS: SortKey[] = ['best', 'name', 'priceLow', 'priceHigh', 'newest'];

export interface Hit {
  item: CatalogItem;
  /** Prices that pass the store, date, promo and price filters, cheapest first. */
  prices: PricePoint[];
  /** The cheapest of those, or null when the item has none. */
  best: PricePoint | null;
  score: number;
}

/** "Today" as YYYY-MM-DD on this phone. */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBefore(today: string, n: number): string {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - n);
  return dayOf(d);
}

const inRange = (c: number, r: PriceRange | null) => !r || ((r.min == null || c >= r.min) && (r.max == null || c <= r.max));

/** How well the text parts match. 0 = no match. Higher = better. Items with no text parts score 1. */
function textScore(item: CatalogItem, q: Query, name: string, hay: string): number {
  let score = 1;
  const code = item.barcode ?? '';
  for (const b of q.barcodes) {
    if (!code.includes(b)) return 0;
    score += code === b ? 100 : code.startsWith(b) ? 50 : 20;
  }
  for (const w of q.words) {
    if (!hay.includes(w)) return 0;
    score += name.startsWith(w) ? 30 : new RegExp(`(^| )${w.replace(/[.]/g, '\\.')}`).test(name) ? 20 : 8;
  }
  if (q.words.length && name === q.words.join(' ')) score += 100;
  return score;
}

/**
 * Items matching the search box and filters, sorted. `today` is YYYY-MM-DD (pass dayOf(new Date())).
 */
export function searchCatalog(catalog: CatalogItem[], input: string | Query, filters: Filters, sort: SortKey, today: string): Hit[] {
  const q = typeof input === 'string' ? parseQuery(input) : input;
  const cats = filters.categories.length ? new Set(filters.categories) : null;
  const since = filters.withinDays != null ? daysBefore(today, filters.withinDays) : null;
  const filterRange: PriceRange | null =
    filters.minCentavos != null || filters.maxCentavos != null ? { min: filters.minCentavos, max: filters.maxCentavos } : null;
  const needsPrice =
    !!filters.store || filters.withPrice || filters.promoOnly || since != null || !!filterRange || !!q.price;

  const hits: Hit[] = [];
  for (const item of catalog) {
    if (cats && !cats.has(item.category)) continue;

    const name = fold(item.name);
    const hay = `${name} ${fold(item.size ?? '')}`;
    let score = textScore(item, q, name, hay);
    if (!score) continue;

    const itemSize = parseSize(item.size) ?? parseSize(item.name);
    if (q.sizes.length && !(itemSize && q.sizes.every((s) => sameSize(s, itemSize)))) continue;
    if (q.sizes.length) score += 15;

    // Prices that count for this search.
    let prices = item.prices.filter(
      (p) =>
        (!filters.store || p.storeKey === filters.store) &&
        (!since || p.seenOn >= since) &&
        (!filters.promoOnly || p.isPromo) &&
        inRange(comparable(p), filterRange) &&
        inRange(comparable(p), q.price),
    );

    // A plain number can be a price, a size or part of the name; any one is enough.
    let numbersOk = true;
    for (const n of q.numbers) {
      // Four or more digits can also be the start of a barcode ("4800" = made in the Philippines).
      const asText =
        new RegExp(`(^|[^0-9.])${String(n).replace('.', '\\.')}($|[^0-9])`).test(hay) ||
        (Number.isInteger(n) && String(n).length >= 4 && (item.barcode ?? '').startsWith(String(n)));
      const asSize = !!itemSize && Math.abs(itemSize.amount - n) < 0.001;
      const asPrice = prices.filter((p) => inRange(comparable(p), wholePeso(String(n))));
      if (asText || asSize) {
        score += 10;
        continue;
      }
      if (asPrice.length) {
        prices = asPrice;
        score += 10;
        continue;
      }
      numbersOk = false;
      break;
    }
    if (!numbersOk) continue;
    if (needsPrice && !prices.length) continue;

    prices = [...prices].sort((a, b) => comparable(a) - comparable(b) || b.seenOn.localeCompare(a.seenOn));
    hits.push({ item, prices, best: prices[0] ?? null, score });
  }

  const byName = (a: Hit, b: Hit) => a.item.name.localeCompare(b.item.name, 'en', { sensitivity: 'base' });
  const newest = (h: Hit) => h.prices.reduce((m, p) => (p.seenOn > m ? p.seenOn : m), '');
  const price = (h: Hit) => (h.best ? comparable(h.best) : null);
  const cmp: Record<SortKey, (a: Hit, b: Hit) => number> = {
    best: (a, b) => b.score - a.score || Number(!!b.best) - Number(!!a.best) || byName(a, b),
    name: byName,
    // Items with no price go last in both price orders.
    priceLow: (a, b) => (price(a) ?? Infinity) - (price(b) ?? Infinity) || byName(a, b),
    priceHigh: (a, b) => (price(b) ?? -Infinity) - (price(a) ?? -Infinity) || byName(a, b),
    newest: (a, b) => newest(b).localeCompare(newest(a)) || byName(a, b),
  };
  return hits.sort(cmp[sort]);
}

/** Stores that have at least one price in the catalog, A to Z, for the store filter. */
export function storesIn(catalog: CatalogItem[]): Array<{ key: string; label: string }> {
  const m = new Map<string, string>();
  for (const it of catalog) for (const p of it.prices) if (!m.has(p.storeKey)) m.set(p.storeKey, p.storeLabel);
  return [...m].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export const categoryLabel = (id: CategoryId) => CATEGORY_BY_ID[id].label;
