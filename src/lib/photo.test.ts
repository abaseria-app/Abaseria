import { describe, expect, it } from 'vitest';
import { googleHidden, googlePhoto, initial, photoPath, privateObjectUrl, squareCrop } from './photo';

describe('squareCrop', () => {
  it('takes the centre of a tall photo', () => {
    expect(squareCrop(3000, 4000)).toEqual({ sx: 0, sy: 500, side: 3000 });
  });
  it('takes the centre of a wide photo', () => {
    expect(squareCrop(1920, 1080)).toEqual({ sx: 420, sy: 0, side: 1080 });
  });
  it('leaves a square alone', () => {
    expect(squareCrop(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
  });
});

describe('googlePhoto', () => {
  it('reads avatar_url, then picture', () => {
    expect(googlePhoto({ user_metadata: { avatar_url: 'https://lh3.googleusercontent.com/a/x' } })).toBe('https://lh3.googleusercontent.com/a/x');
    expect(googlePhoto({ user_metadata: { picture: 'https://lh3.googleusercontent.com/a/y' } })).toBe('https://lh3.googleusercontent.com/a/y');
  });
  it('ignores missing or non-https links', () => {
    expect(googlePhoto({ user_metadata: {} })).toBeNull();
    expect(googlePhoto({ user_metadata: { avatar_url: 'http://example.com/a.jpg' } })).toBeNull();
    expect(googlePhoto(null)).toBeNull();
  });
});

describe('googleHidden', () => {
  it('is off unless the shopper hid it', () => {
    expect(googleHidden({ user_metadata: {} })).toBe(false);
    expect(googleHidden({ user_metadata: { abaseria_hide_google_photo: true } })).toBe(true);
  });
});

describe('initial and path', () => {
  it('uses the name, then the email', () => {
    expect(initial('juan dela cruz', 'j@x.com')).toBe('J');
    expect(initial(null, 'maria@gmail.com')).toBe('M');
    expect(initial(' ', null)).toBe('?');
  });
  it('stores one file per account', () => {
    expect(photoPath('abc')).toBe('abc/photo');
  });
});

describe('privateObjectUrl', () => {
  it('builds the signed-in download address', () => {
    expect(privateObjectUrl('https://abc.supabase.co/', 'profile-photos', 'u-1/photo')).toBe(
      'https://abc.supabase.co/storage/v1/object/authenticated/profile-photos/u-1/photo',
    );
  });
});
