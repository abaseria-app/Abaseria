// Profile photo (task P2b). Spec: project doc Abaseria_Shopper_Profile_Spec.md, section 3c.
//
// Seen only by the shopper. Sources, in the order shown:
//   1. a photo the shopper uploaded (selfie or gallery), stored privately at profile-photos/<user id>/photo
//   2. the photo from their Google account, shown from Google's link (nothing copied), unless they hid it
//   3. their initial
//
// Every upload is redrawn on a canvas at 256x256 before it leaves the phone. A canvas keeps only pixels, so
// the file's hidden data (GPS location, camera model, date) is dropped. The storage rules (migration 018)
// make sure nobody else can read, replace or delete the file.
import type { User } from '@supabase/supabase-js';
import { dbConfig, getSupabase } from './supabase';

export const PHOTO_BUCKET = 'profile-photos';
export const PHOTO_SIZE = 256;
export const PHOTO_MAX_BYTES = 200 * 1024;
const HIDE_GOOGLE_KEY = 'abaseria_hide_google_photo';

export const photoPath = (userId: string) => `${userId}/photo`;

/** The signed-in download address for a private file. */
export function privateObjectUrl(base: string, bucket: string, path: string): string {
  return `${base.replace(/\/$/, '')}/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** The centered square to cut from a w × h picture. */
export function squareCrop(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}

/** The Google photo link from sign-in, if there is one. */
export function googlePhoto(user: Pick<User, 'user_metadata'> | null | undefined): string | null {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const url = [meta.avatar_url, meta.picture].find((v): v is string => typeof v === 'string' && v.startsWith('https://'));
  return url ?? null;
}

export function googleHidden(user: Pick<User, 'user_metadata'> | null | undefined): boolean {
  return (user?.user_metadata as Record<string, unknown> | undefined)?.[HIDE_GOOGLE_KEY] === true;
}

/** The first letter of the name or email, for when there's no photo. */
export function initial(name: string | null | undefined, email: string | null | undefined): string {
  const s = (name ?? '').trim() || (email ?? '').trim();
  return s ? s[0].toUpperCase() : '?';
}

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  // Respect the phone's rotation flag, so selfies aren't sideways.
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
 * A 256x256 WebP (JPEG where WebP can't be made) of the centre of the picture, under 200 KB, with none of
 * the original file's hidden data.
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const src = await decode(file);
  const { sx, sy, side } = squareCrop(src.width, src.height);
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  if ('close' in src && typeof src.close === 'function') src.close();
  for (const q of [0.82, 0.65, 0.5]) {
    let out = await toBlob(canvas, 'image/webp', q);
    if (!out || out.type !== 'image/webp') out = await toBlob(canvas, 'image/jpeg', q);
    if (out && out.size <= PHOTO_MAX_BYTES) return out;
  }
  throw new Error('photo too large');
}

export interface PhotoState {
  userId: string;
  /** A link to show the uploaded photo (an object URL; revoke it when done), or null. */
  uploaded: string | null;
  google: string | null;
  googleHidden: boolean;
}

async function session() {
  const client = await getSupabase().catch(() => null);
  if (!client) throw new Error('no database');
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user || user.is_anonymous) throw new Error('not signed in');
  return { client, user };
}

/** What to show. Offline or on error, the uploaded photo is left out and the Google photo still shows. */
export async function loadPhoto(): Promise<PhotoState> {
  const { client, user } = await session();
  let uploaded: string | null = null;
  if (dbConfig && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    // Fetched by hand with cache: 'no-store'. The library's download() let the phone's browser answer from
    // its cache, so a removed photo kept showing for up to a minute (Nov 16 phone test).
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    const res = await fetch(privateObjectUrl(dbConfig.url, PHOTO_BUCKET, photoPath(user.id)), {
      headers: { apikey: dbConfig.key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: 'no-store',
    }).catch(() => null);
    if (res?.ok) {
      const blob = await res.blob();
      if (blob.size) uploaded = URL.createObjectURL(blob);
    }
  }
  return { userId: user.id, uploaded, google: googlePhoto(user), googleHidden: googleHidden(user) };
}

/** Shrinks, strips and saves a selfie or gallery photo, replacing any earlier one. */
export async function uploadPhoto(file: Blob): Promise<void> {
  const blob = await shrinkPhoto(file);
  const { client, user } = await session();
  const { error } = await client.storage
    .from(PHOTO_BUCKET)
    .upload(photoPath(user.id), blob, { upsert: true, contentType: blob.type, cacheControl: '0' });
  if (error) throw new Error(error.message);
}

/** Deletes the uploaded file. The Google photo (if any, and not hidden) shows again. */
export async function removePhoto(): Promise<void> {
  const { client, user } = await session();
  const { error } = await client.storage.from(PHOTO_BUCKET).remove([photoPath(user.id)]);
  if (error) throw new Error(error.message);
}

/** Hides or shows the Google photo. Kept on the account, so it follows the shopper to another phone. */
export async function hideGooglePhoto(hidden: boolean): Promise<void> {
  const { client } = await session();
  const { error } = await client.auth.updateUser({ data: { [HIDE_GOOGLE_KEY]: hidden } });
  if (error) throw new Error(error.message);
}
