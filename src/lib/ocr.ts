import { createWorker, type Worker } from 'tesseract.js';
import { findPriceCandidates, guessName, looksLikePromo, type OcrLine, type PriceCandidate, restoreRaisedCents, type TagContext } from './priceParser';

// Everything loads from our own origin (copied in by scripts/copy-ocr.mjs) so OCR works offline.
const assetBase = () => new URL(`${import.meta.env.BASE_URL}tesseract/`, window.location.href).href;

let workerPromise: Promise<Worker> | null = null;

/** Starts the OCR engine. Called at app load so the first tag photo doesn't pay the 1-3 s startup. */
export function warmOcr(): Promise<Worker> {
  if (!workerPromise) {
    const base = assetBase();
    workerPromise = createWorker('eng', 1 /* LSTM only */, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base.replace(/\/$/, ''),
      gzip: true,
    }).then(async (w) => {
      // Sparse text: tags are scattered words and numbers, not paragraphs.
      await w.setParameters({ tessedit_pageseg_mode: '11' as never, user_defined_dpi: '300' });
      return w;
    });
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** The on-screen guide box, as fractions of the frame. Only this region is read. */
export const GUIDE = { x: 0.06, y: 0.27, w: 0.88, h: 0.46 };

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Maps the on-screen guide box to pixels in the camera frame. The video is shown with object-fit: cover,
 * so part of the frame is cut off on screen and a plain percentage crop would read the wrong area.
 */
export function guideToSourceRect(video: HTMLVideoElement, guide: HTMLElement): Rect {
  const v = video.getBoundingClientRect();
  const g = guide.getBoundingClientRect();
  const scale = Math.max(v.width / video.videoWidth, v.height / video.videoHeight);
  const offX = (v.width - video.videoWidth * scale) / 2;
  const offY = (v.height - video.videoHeight * scale) / 2;
  const x = Math.max(0, (g.left - v.left - offX) / scale);
  const y = Math.max(0, (g.top - v.top - offY) / scale);
  return {
    x,
    y,
    w: Math.min(video.videoWidth - x, g.width / scale),
    h: Math.min(video.videoHeight - y, g.height / scale),
  };
}

/**
 * Crops (to the guide box when given), downsizes, converts to grayscale and stretches contrast.
 * Smaller input is the biggest speed win for OCR on a mid-range phone.
 */
export function prepareImage(source: HTMLVideoElement | HTMLImageElement | ImageBitmap, crop?: Rect): HTMLCanvasElement {
  const sw = 'videoWidth' in source ? source.videoWidth : source.width;
  const sh = 'videoHeight' in source ? source.videoHeight : source.height;
  const { x: sx, y: sy, w: cw, h: ch } = crop ?? { x: 0, y: 0, w: sw, h: sh };
  const scale = Math.min(1, 1400 / cw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = g;
    hist[g | 0]++;
  }
  // Stretch between the 2nd and 98th percentile so washed-out photos still have crisp digits.
  const total = px.length / 4;
  let lo = 0;
  let hi = 255;
  for (let acc = 0, v = 0; v < 256; v++) if ((acc += hist[v]) > total * 0.02) { lo = v; break; }
  for (let acc = 0, v = 255; v >= 0; v--) if ((acc += hist[v]) > total * 0.02) { hi = v; break; }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface OcrResult {
  candidates: PriceCandidate[];
  nameGuess: string | null;
  promoHint: boolean;
  lines: OcrLine[];
  ms: number;
}

export async function readTag(canvas: HTMLCanvasElement, ctx: TagContext = {}): Promise<OcrResult> {
  const t0 = performance.now();
  const worker = await warmOcr();
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        const digitWords = line.words.filter((w) => /\d/.test(w.text));
        const height = digitWords.length
          ? Math.max(...digitWords.map((w) => w.bbox.y1 - w.bbox.y0))
          : line.bbox.y1 - line.bbox.y0;
        // Rebuilt word by word so raised centavos (₱45⁰⁰) get their decimal point back.
        const text = line.words.map((w) => restoreRaisedCents(w.text, w.symbols ?? [])).join(' ');
        lines.push({ text: text.trim() || line.text.trim(), height });
      }
    }
  }
  return {
    candidates: findPriceCandidates(lines, 4, ctx),
    nameGuess: guessName(lines),
    promoHint: looksLikePromo(lines),
    lines,
    ms: Math.round(performance.now() - t0),
  };
}
