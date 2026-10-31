// Finds and ranks price candidates in OCR text from Philippine shelf tags.
// A tag often shows an old price, a promo price, a per-kg or per-100g price, barcode digits and an SKU,
// so this never guesses one number. It returns ranked candidates and the shopper picks.

export type UnitHint = 'kg' | '100g' | 'pc' | null;

export interface OcrLine {
  text: string;
  /** Pixel height of the digits on this line. Bigger text is usually the selling price. */
  height?: number;
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
const BUNDLE_RE = new RegExp(`\\b(\\d{1,2})\\s*(?:for|FOR|For|\\/)\\s*${MARKER}?\\s?(\\d{1,5}(?:\\.\\d{2})?)(?![\\d/])`, 'g');
// OCR often reads the slash in "/kg" as I, l or |.
const UNIT_RE = /^\s*(?:\/|[Il|](?=\s?(?:kg|100))|per\s+|\s)\s*(kg|kilo|100\s?g|pcs?|pack|ea|each)\b/i;
const ID_PREFIX_RE = /(sku|code|item|art|no\.?|#)\s*:?\s*$/i;
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

function scanLine(line: OcrLine, out: PriceCandidate[]) {
  const text = line.text;
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

    const n = normalizeNumber(raw);
    if (!n || n.centavos <= 0 || n.centavos > MAX_CENTAVOS) continue;
    if (!marker && !n.hasDecimal) {
      if (n.intDigits < 2 || n.intDigits > 5) continue; // a lone "3" is a count, not a price
      if (/^(19|20)\d\d$/.test(String(n.centavos / 100))) continue; // years
    }
    if (marker === 'F' && !/\s/.test(m[2]) && !n.hasDecimal && n.intDigits < 2) marker = undefined;

    out.push({ centavos: n.centavos, unit, bundleQty: null, hasMarker: !!marker, height, score: n.hasDecimal ? 1 : 0 });
  }
}

/** Returns up to `max` candidates, best first. */
export function findPriceCandidates(lines: OcrLine[], max = 4): PriceCandidate[] {
  const raw: PriceCandidate[] = [];
  for (const line of lines) scanLine(line, raw);
  const maxH = Math.max(1, ...raw.map((c) => c.height));

  for (const c of raw) {
    c.score += (c.height / maxH) * 10 + (c.hasMarker ? 3 : 0) + (c.bundleQty ? 1 : 0);
    if (c.unit === 'kg') c.score -= 2;
    if (c.unit === '100g') c.score -= 3;
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
