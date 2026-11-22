// Tester feedback (Nov 20, 2026): Settings → Send feedback. Database rules: migration 024.
//
// A message goes to public.feedback with its kind, where in the app (optional), and what the phone adds:
// dev or live app, build, phone model and screen size. A screenshot, if attached, is redrawn on a canvas
// first (max 1600 px on the long side, WebP or JPEG under 1 MB), which drops the file's hidden data (GPS,
// camera, date), then saved privately at feedback-screenshots/<user id>/<random id>.webp. Only the sender
// and Abaseria staff can open it. Each message emails Brad (security-alert function).
import { dbConfig, getSupabase } from './supabase';

export const FEEDBACK_KINDS = ['problem', 'comment', 'suggestion', 'concern'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_AREAS = ['scan', 'trip', 'products', 'list', 'recipes', 'budget', 'profile', 'signin', 'other'] as const;
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];

export const MESSAGE_MIN = 3;
export const MESSAGE_MAX = 2000;
export const SHOT_BUCKET = 'feedback-screenshots';
export const SHOT_LONG_SIDE = 1600;
export const SHOT_MAX_BYTES = 1024 * 1024;

/** The build this phone is running, e.g. "3f2a9c1 2026-11-20" (set in vite.config.ts). */
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'local';

export function messageOk(text: string): boolean {
  const n = text.trim().length;
  return n >= MESSAGE_MIN && n <= MESSAGE_MAX;
}

/** Width and height scaled down (never up) so the long side is at most `max`. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max || long === 0) return { w, h };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** The part of the browser's user agent that names the phone and Android/iOS version, at most 300 characters. */
export function deviceSummary(userAgent: string): string {
  const inside = /\(([^)]*)\)/.exec(userAgent)?.[1] ?? '';
  const chrome = /(?:Chrome|CriOS|Version)\/([\d.]+)/.exec(userAgent)?.[0] ?? '';
  const s = [inside, chrome].filter(Boolean).join(' · ') || userAgent;
  return s.slice(0, 300);
}

export function screenSummary(w: number, h: number, dpr: number): string {
  return `${Math.round(w)}x${Math.round(h)} @${Math.round(dpr * 100) / 100}`.slice(0, 40);
}

/** Path for a new screenshot. The database refuses any other shape (migration 024). */
export function shotPath(userId: string, id: string, type: string): string {
  return `${userId}/${id}.${type === 'image/jpeg' ? 'jpg' : 'webp'}`;
}

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall back to <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * A copy of the screenshot small enough to send (WebP, or JPEG where WebP can't be made), under 1 MB, with
 * none of the original file's hidden data. Text stays readable: the long side is 1600 px, then 1200 if needed.
 */
export async function shrinkScreenshot(file: Blob): Promise<Blob> {
  const src = await decode(file);
  try {
    for (const side of [SHOT_LONG_SIDE, 1200]) {
      const { w, h } = fitWithin(src.width, src.height, side);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      for (const q of [0.82, 0.65, 0.5]) {
        let out = await toBlob(canvas, 'image/webp', q);
        if (!out || out.type !== 'image/webp') out = await toBlob(canvas, 'image/jpeg', q);
        if (out && out.size <= SHOT_MAX_BYTES) return out;
      }
    }
  } finally {
    if ('close' in src && typeof src.close === 'function') src.close();
  }
  throw new Error('screenshot too large');
}

export type SendError = 'offline' | 'signed-out' | 'daily-limit' | 'bad-picture' | 'failed';

export class FeedbackError extends Error {
  reason: SendError;
  constructor(reason: SendError, detail?: string) {
    super(detail ?? reason);
    this.reason = reason;
  }
}

export interface FeedbackInput {
  kind: FeedbackKind;
  area: FeedbackArea | null;
  message: string;
  /** Already shrunk with shrinkScreenshot. */
  screenshot: Blob | null;
}

/** Uploads the screenshot (if any), then saves the message. Throws FeedbackError. */
export async function sendFeedback(input: FeedbackInput): Promise<void> {
  if (!dbConfig) throw new FeedbackError('failed', 'no database');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new FeedbackError('offline');
  const client = await getSupabase().catch(() => null);
  if (!client) throw new FeedbackError('failed', 'no database');
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user || user.is_anonymous) throw new FeedbackError('signed-out');

  let screenshot_path: string | null = null;
  if (input.screenshot) {
    screenshot_path = shotPath(user.id, crypto.randomUUID(), input.screenshot.type);
    const { error } = await client.storage
      .from(SHOT_BUCKET)
      .upload(screenshot_path, input.screenshot, { upsert: false, contentType: input.screenshot.type });
    if (error) throw new FeedbackError(navigator.onLine === false ? 'offline' : 'failed', error.message);
  }

  const { error } = await client.from('feedback').insert({
    kind: input.kind,
    area: input.area,
    message: input.message.trim(),
    screenshot_path,
    app_env: dbConfig.target,
    app_build: APP_BUILD.slice(0, 40),
    device: deviceSummary(navigator.userAgent),
    screen: screenSummary(window.screen.width, window.screen.height, window.devicePixelRatio || 1),
  });
  if (error) {
    if (/feedback_daily_limit/.test(error.message)) throw new FeedbackError('daily-limit');
    throw new FeedbackError(navigator.onLine === false ? 'offline' : 'failed', error.message);
  }
}
