// List thumbnails: the product's one reference image from the shared database, shrunk to a small square.
//
// The full image can be a few hundred KB; the list shows it at 56 px. Shrinking it once at scan time and
// keeping it with the item means the list works offline and the phone doesn't refetch it every trip.
// Shoppers' cameras never supply this image.

/** Pixels per side: sharp at 56 px on 3x screens, about 5-8 KB as JPEG. */
export const THUMB_PX = 168;
const QUALITY = 0.8;

/** Where a w × h image sits inside a square box when it's fit whole (letterboxed), centered. */
export function fitInside(w: number, h: number, box = THUMB_PX): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(box / w, box / h);
  const fw = Math.round(w * scale);
  const fh = Math.round(h * scale);
  return { x: Math.round((box - fw) / 2), y: Math.round((box - fh) / 2), w: fw, h: fh };
}

/**
 * The image fit whole on a white square, as a JPEG data URL. White matches the plain backgrounds product
 * shots usually have. Null when the file isn't an image this phone can read.
 */
export async function shrinkImage(file: Blob): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = THUMB_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx || !bmp.width || !bmp.height) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, THUMB_PX, THUMB_PX);
    const r = fitInside(bmp.width, bmp.height);
    ctx.drawImage(bmp, r.x, r.y, r.w, r.h);
    bmp.close?.();
    const url = canvas.toDataURL('image/jpeg', QUALITY);
    return url.startsWith('data:image/jpeg') ? url : null;
  } catch {
    return null;
  }
}
