// Product barcodes: validation and the browser's built-in detector.
//
// Chrome on Android ships BarcodeDetector. iPhone browsers don't, so on those phones the capture
// screen skips straight to the shelf tag. A bundled reader for iPhones is a later step.

/** GTIN check digit (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function gtinOk(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < code.length; i++) {
    const fromRight = code.length - 1 - i;
    sum += Number(code[i]) * (fromRight % 2 === 1 ? 3 : 1);
  }
  return sum % 10 === 0;
}

/**
 * 13-digit codes starting with 2 are printed in the store (deli, meat, produce scales) and usually carry
 * that package's weight or price, so they don't identify a product.
 */
export const isInStoreCode = (code: string) => code.length === 13 && code.startsWith('2');

/**
 * One form per product: UPC-A stays 12 digits. Some phones report it, and some brand lists write it, as
 * 13 digits with a leading 0. That's the same can, and the shared database refuses that form (migration 006),
 * so the 0 is dropped. The check digit is unchanged by a leading 0.
 */
export const canonicalBarcode = (code: string) => (code.length === 13 && code.startsWith('0') ? code.slice(1) : code);

/** UPC-E expands to UPC-A; UPC-A read as 13 digits loses its leading 0; everything else is used as read. */
export function normalizeBarcode(raw: string, format: string): string | null {
  const code = raw.replace(/\D/g, '');
  if (format === 'upc_e' && code.length === 8) {
    const expanded = expandUpcE(code);
    return expanded && gtinOk(expanded) ? expanded : null;
  }
  return gtinOk(code) ? canonicalBarcode(code) : null;
}

function expandUpcE(e: string): string | null {
  const [ns, d1, d2, d3, d4, d5, d6, check] = e.split('');
  if (ns !== '0' && ns !== '1') return null;
  let body: string;
  if ('012'.includes(d6)) body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
}

// Minimal types; BarcodeDetector isn't in TypeScript's DOM library yet.
interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

const WANTED = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let detectorPromise: Promise<BarcodeDetectorLike | null> | null = null;

/** The detector, or null when this browser can't read product barcodes. */
export function getDetector(): Promise<BarcodeDetectorLike | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!Ctor) return null;
      try {
        const formats = (await Ctor.getSupportedFormats()).filter((f) => WANTED.includes(f));
        return formats.length ? new Ctor({ formats }) : null;
      } catch {
        return null;
      }
    })();
  }
  return detectorPromise;
}

export interface ScanHit {
  /** A product barcode with a valid check digit, or null for an in-store scale code. */
  code: string | null;
  raw: string;
}

/** One look at the current video frame. Null when nothing readable is in view. */
export async function scanFrame(detector: BarcodeDetectorLike, video: HTMLVideoElement): Promise<ScanHit | null> {
  const found = await detector.detect(video);
  for (const b of found) {
    const code = normalizeBarcode(b.rawValue, b.format);
    if (!code) continue;
    return { code: isInStoreCode(code) ? null : code, raw: code };
  }
  return null;
}

/**
 * Digits grouped the way they're printed under the bars, so a shopper can check them against the package:
 * EAN-13 "4 800016 644115", UPC-A "0 36000 29145 2", EAN-8 "9638 5074". Anything else is shown as is.
 */
export function formatBarcode(code: string): string {
  if (/^\d{13}$/.test(code)) return `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`;
  if (/^\d{12}$/.test(code)) return `${code[0]} ${code.slice(1, 6)} ${code.slice(6, 11)} ${code[11]}`;
  if (/^\d{8}$/.test(code)) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}
