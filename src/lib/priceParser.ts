// Finds and ranks price candidates in OCR text from Philippine shelf tags.
// A tag often shows an old price, a promo price, a per-kg or per-100g price, barcode digits and an SKU,
// so this never guesses one number. It returns ranked candidates and the shopper picks.

export type UnitHint = 'kg' | '100g' | 'pc' | null;

export interface OcrLine {
  text: string;
  /** Pixel height of the digits on this line. Bigger text is usually the selling price. */
  height?: number;
}

/** What the capture screen already knows, used to rule out and rank numbers on the tag. */
export interface TagContext {
  /** The barcode just scanned. Its digits are often printed on the shelf tag too. */
  barcode?: string | null;
  /** A recent price for this product (this phone at another store, or other shoppers). */
  referenceCentavos?: number | null;
}

export interface PriceCandidate {
  /** Price in centavos. For a bundle this is the bundle price ("3 for ₱100" -> 10000). */
  centavos: number;
  unit: UnitHint;
  bundleQty: number | null;
  hasMarker: boolean;
  height: number;
  score: number;
}

const MAX_CENTAVOS = 50_000_00;
const MARKER = '(₱|PHP|Php|php|P|p|F)';
// Digits plus the letters OCR confuses with them. Only normalized inside a matched number.
const NUM = '([0-9lIOo](?:[0-9lIOo,]*[0-9lIOo])?(?:\\s?\\.\\s?[0-9lIOo]{2})?)';
// The lookbehind stops a match from starting mid-word or mid-number ("No. 445566" must not yield "5566").
const AMOUNT_RE = new RegExp(`(?<![A-Za-z0-9.])${MARKER}?(\\s?)${NUM}`, 'g');
// The lookbehind keeps dates out: in "11/04/26" the "04/26" is not "4 for ₱26".
const BUNDLE_RE = new RegExp(`(?<![\\d/.,-])\\b(\\d{1,2})\\s*(?:for|FOR|For|\\/)\\s*${MARKER}?\\s?(\\d{1,5}(?:\\.\\d{2})?)(?![\\d/])`, 'g');
// OCR often reads the slash in "/kg" as I, l or |.
const UNIT_RE = /^\s*(?:\/|[Il|](?=\s?(?:kg|100))|per\s+|\s)\s*(kg|kilo|100\s?g|pcs?|pack|ea|each)\b/i;
const ID_PREFIX_RE = /(sku|code|item|art|no\.?|#)\s*:?\s*$/i;
// Digit groups split by single spaces: "7 48485 10004 3" is a UPC printed under its bars.
const DIGIT_RUN_RE = /(?<![\d.,₱])\d+(?: \d+)+(?![\d.,])/g;
// A count of items, not a price: "48/CS", "12/box", "x 24", "24 x".
const PACK_AFTER_RE = /^\s*(?:\/\s*(?:cs|case|box|bx|pack|pk|ctn|carton)\b|[x×](?![A-Za-z]))/i;
const PACK_BEFORE_RE = /\b(?:cs|case|box|ctn|carton|pack of|bulk|per case)\s*:?\s*$/i;
// "x 24" is a count, but "12 x 35.00" is a price: after an x, only numbers without centavos are counts.
const TIMES_BEFORE_RE = /[x×]\s*$/i;
// A case or line total: "12 x 35.00 = 420.00", "CASE P1,680.00".
const TOTAL_BEFORE_RE = /(?:=|\b(?:case|cs|box|carton|ctn|bulk|total)\b[^0-9]{0,6})\s*$/i;
const isLetter = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);
const isDigit = (c: string | undefined) => !!c && /[0-9]/.test(c);

function normalizeNumber(raw: string): { centavos: number; intDigits: number; hasDecimal: boolean } | null {
  let s = raw.replace(/\s/g, '').replace(/[lI]/g, '1').replace(/[Oo]/g, '0');
  if (/^\d+,\d{2}$/.test(s)) s = s.replace(',', '.'); // "115,00" read as decimal
  if (s.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d{2})?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }
  const m = /^(\d+)(?:\.(\d{2}))?$/.exec(s);
  if (!m) return null;
  const intDigits = m[1].replace(/^0+(?=\d)/, '').length;
  if (intDigits > 6) return null; // barcodes, SKUs
  const centavos = Number(m[1]) * 100 + Number(m[2] ?? '0');
  return { centavos, intDigits, hasDecimal: m[2] !== undefined };
}

function unitFor(after: string): UnitHint {
  const m = UNIT_RE.exec(after);
  if (!m) return null;
  const u = m[1].toLowerCase().replace(/\s/g, '');
  if (u === 'kg' || u === 'kilo') return 'kg';
  if (u === '100g') return '100g';
  return 'pc';
}

/** Blanks out barcode digits so their groups can't pass for prices. Keeps every other character in place. */
function maskBarcodes(text: string, barcode?: string | null): string {
  let t = text.replace(DIGIT_RUN_RE, (run) => (run.replace(/\D/g, '').length >= 8 ? ' '.repeat(run.length) : run));
  if (barcode && barcode.length >= 8) {
    // Any 5+ digit group that's part of the scanned barcode, however OCR split it.
    t = t.replace(/(?<![\d.,])\d{5,}(?![\d.,])/g, (g) => (barcode.includes(g) ? ' '.repeat(g.length) : g));
  }
  return t;
}

function scanLine(line: OcrLine, out: PriceCandidate[], ctx: TagContext) {
  const text = maskBarcodes(line.text, ctx.barcode);
  const height = line.height ?? 1;
  const consumed: Array<[number, number]> = [];

  for (const m of text.matchAll(BUNDLE_RE)) {
    const qty = Number(m[1]);
    const n = normalizeNumber(m[3]);
    if (!n || qty < 2 || qty > 12 || n.centavos <= 0 || n.centavos > MAX_CENTAVOS) continue;
    out.push({ centavos: n.centavos, unit: null, bundleQty: qty, hasMarker: !!m[2], height, score: 0 });
    consumed.push([m.index!, m.index! + m[0].length]);
  }

  for (const m of text.matchAll(AMOUNT_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (consumed.some(([a, b]) => start < b && end > a)) continue;
    let marker: string | undefined = m[1];
    const raw = m[3];
    const before = text[start - 1];
    const after = text[end];

    if (!/[0-9]/.test(raw)) continue; // "OO" in "SHAMPOO"
    if (raw.replace(/[0-9,.\s]/g, '').length > 2) continue;
    if (marker && marker.length === 1 && isLetter(before)) continue; // the "P" is part of a word
    if (!marker && isLetter(before)) continue; // "B12", "SKU12345"
    if (isLetter(after)) continue; // sizes: "60g", "250ML", "3pcs"
    const unit = unitFor(text.slice(end, end + 14));
    if (!unit && (after === '/' || after === '-' || after === ':') && isDigit(text[end + 1])) continue; // dates, times
    if ((before === '/' || before === '-') && isDigit(text[start - 2])) continue;
    if (ID_PREFIX_RE.test(text.slice(Math.max(0, start - 8), start))) continue;
    if (!marker && (PACK_AFTER_RE.test(text.slice(end, end + 10)) || PACK_BEFORE_RE.test(text.slice(Math.max(0, start - 10), start)))) continue;
    if (!marker && !/\.\s?[0-9lIOo]{2}$/.test(raw) && TIMES_BEFORE_RE.test(text.slice(Math.max(0, start - 4), start))) continue;
    const isTotal = TOTAL_BEFORE_RE.test(text.slice(Math.max(0, start - 14), start));

    const n = normalizeNumber(raw);
    if (!n || n.centavos <= 0 || n.centavos > MAX_CENTAVOS) continue;
    if (!marker && !n.hasDecimal) {
      if (n.intDigits < 2 || n.intDigits > 5) continue; // a lone "3" is a count, not a price
      if (/^(19|20)\d\d$/.test(String(n.centavos / 100))) continue; // years
    }
    if (marker === 'F' && !/\s/.test(m[2]) && !n.hasDecimal && n.intDigits < 2) marker = undefined;

    const base = (n.hasDecimal ? 1 : 0) - (isTotal ? 8 : 0);
    const plainDigits = !n.hasDecimal && !raw.includes(',');
    if (plainDigits && n.intDigits >= 3) {
      // Tags print centavos small and raised (₱45⁰⁰), and OCR drops the gap: "4500" is usually ₱45.00.
      // From 4 digits up that reading goes first; for 3 digits ("P150") the whole number does.
      const split = { centavos: Math.round(n.centavos / 100), unit, bundleQty: null, hasMarker: !!marker, height, score: base };
      const whole = { centavos: n.centavos, unit, bundleQty: null, hasMarker: !!marker, height, score: base };
      if (n.intDigits >= 4) whole.score -= 4;
      else split.score -= 4;
      if (split.centavos > 0) out.push(split);
      out.push(whole);
      continue;
    }
    out.push({ centavos: n.centavos, unit, bundleQty: null, hasMarker: !!marker, height, score: base });
  }
}

/** Returns up to `max` candidates, best first. */
export function findPriceCandidates(lines: OcrLine[], max = 4, ctx: TagContext = {}): PriceCandidate[] {
  const raw: PriceCandidate[] = [];
  for (const line of lines) scanLine(line, raw, ctx);
  const maxH = Math.max(1, ...raw.map((c) => c.height));
  const ref = ctx.referenceCentavos && ctx.referenceCentavos > 0 ? ctx.referenceCentavos : null;

  for (const c of raw) {
    c.score += (c.height / maxH) * 10 + (c.hasMarker ? 3 : 0) + (c.bundleQty ? 1 : 0);
    if (c.unit === 'kg') c.score -= 2;
    if (c.unit === '100g') c.score -= 3;
    if (ref && !c.bundleQty && !c.unit) {
      // Prices move, but not 10×: near the known price goes up, wildly off goes down.
      const ratio = c.centavos / ref;
      if (ratio >= 0.4 && ratio <= 2.5) c.score += 6;
      else if (ratio > 10 || ratio < 0.1) c.score -= 6;
    }
  }

  const best = new Map<string, PriceCandidate>();
  for (const c of raw) {
    const key = `${c.centavos}|${c.unit}|${c.bundleQty}`;
    const prev = best.get(key);
    if (!prev || c.score > prev.score) best.set(key, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, max);
}

const STOP_LINES = /^(sale|promo|save|now|only|price|regular|reg|special|less|off|new|each|per)\b/i;

/** Best guess at the product name: the line with the most letters that isn't a price or promo banner. */
export function guessName(lines: OcrLine[]): string | null {
  let bestLine: string | null = null;
  let bestLetters = 0;
  for (const { text } of lines) {
    const clean = text.replace(/[^A-Za-z0-9 .\-/%&ñÑ]/g, ' ').replace(/\s+/g, ' ').trim();
    const letters = (clean.match(/[A-Za-zñÑ]/g) ?? []).length;
    const nonSpace = clean.replace(/\s/g, '').length;
    if (letters < 4 || letters / Math.max(1, nonSpace) < 0.5) continue;
    if (STOP_LINES.test(clean)) continue;
    if (findPriceCandidates([{ text }]).some((c) => c.hasMarker)) continue;
    if (letters > bestLetters) {
      bestLetters = letters;
      bestLine = clean;
    }
  }
  if (!bestLine) return null;
  return bestLine
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .slice(0, 60);
}

export function looksLikePromo(lines: OcrLine[]): boolean {
  return lines.some((l) => /\b(sale|promo|save|now only|special|discount|less)\b/i.test(l.text));
}

/** One OCR character: its text and box (pixels). */
export interface OcrSymbol {
  text: string;
  bbox: { y0: number; y1: number };
}

/**
 * Puts the decimal point back into a price printed with small raised centavos: ₱45⁰⁰ reads as "P4500",
 * but its last two digits are shorter and sit higher than the rest. Returns the word unchanged otherwise.
 */
export function restoreRaisedCents(word: string, symbols: OcrSymbol[]): string {
  if (!/\d{3,}$/.test(word) || /[.,]\d{2}$/.test(word) || symbols.length !== word.length) return word;
  const digits = symbols.filter((s) => /\d/.test(s.text));
  if (digits.length < 3) return word;
  const cents = digits.slice(-2);
  const pesos = digits.slice(0, -2);
  const h = (s: OcrSymbol) => s.bbox.y1 - s.bbox.y0;
  const pesoH = Math.min(...pesos.map(h));
  const pesoBottom = Math.max(...pesos.map((s) => s.bbox.y1));
  const centsH = Math.max(...cents.map(h));
  const centsBottom = Math.max(...cents.map((s) => s.bbox.y1));
  const smaller = centsH <= pesoH * 0.75;
  const raised = pesoBottom - centsBottom >= pesoH * 0.2;
  return smaller && raised ? `${word.slice(0, -2)}.${word.slice(-2)}` : word;
}
