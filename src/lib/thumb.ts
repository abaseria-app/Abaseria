// Item thumbnails: one small square photo per item, taken from the camera frame the shopper already aimed.
//
// Barcode items get a frame from the moment the barcode read, which shows the package. Tag-only items
// (iPhones, produce, meat) get the shelf-tag photo. Typed items have none and show a placeholder.
// Thumbnails stay on this phone: they aren't in the CSV export and aren't shared with other phones.

/** Pixels per side. Shown at 56 px, so this is sharp on 2x screens and about 4-7 KB as JPEG. */
export const THUMB_PX = 112;
const QUALITY = 0.7;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The square to cut from a w × h frame: centered on `focus` (or the frame's center) and as big as fits.
 * `fill` is how much of the short side to keep; 0.8 trims the edges where the shelf usually is.
 */
export function squareCrop(w: number, h: number, focus?: Rect, fill = 0.8): Rect {
  const cx = focus ? focus.x + focus.w / 2 : w / 2;
  const cy = focus ? focus.y + focus.h / 2 : h / 2;
  const side = Math.round(Math.min(w, h) * fill);
  const x = Math.round(Math.min(Math.max(cx - side / 2, 0), w - side));
  const y = Math.round(Math.min(Math.max(cy - side / 2, 0), h - side));
  return { x, y, w: side, h: side };
}

type Source = HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

function size(s: Source): { w: number; h: number } {
  if (s instanceof HTMLVideoElement) return { w: s.videoWidth, h: s.videoHeight };
  return { w: s.width, h: s.height };
}

/** A JPEG data URL of the frame's center (or around `focus`), or null if the frame is empty or the phone can't encode. */
export function makeThumb(source: Source, focus?: Rect): string | null {
  try {
    const { w, h } = size(source);
    if (!w || !h) return null;
    const c = squareCrop(w, h, focus);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = THUMB_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, c.x, c.y, c.w, c.h, 0, 0, THUMB_PX, THUMB_PX);
    const url = canvas.toDataURL('image/jpeg', QUALITY);
    return url.startsWith('data:image/jpeg') ? url : null;
  } catch {
    return null;
  }
}
