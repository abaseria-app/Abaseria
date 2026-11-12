// Facebook, Messenger and Instagram open links in their own built-in browser. Google refuses to sign anyone
// in there ("disallowed_useragent"), so a shopper who taps Continue with Google from a Messenger link never
// gets back to the app (seen Nov 11, 2026: two tries from Facebook on Android 16, neither came back).
// The sign-in screen spots these browsers and sends the shopper to Chrome instead.
import { cleanUrl } from './auth';

export type InAppBrowser = 'facebook' | 'messenger' | 'instagram';

/** Which app's built-in browser this is, from the user agent, or null for a normal browser. */
export function detectInAppBrowser(ua: string): InAppBrowser | null {
  if (/Instagram/.test(ua)) return 'instagram';
  // Messenger on Android calls itself Orca (FB_IAB/Orca-Android); on iPhone, MessengerForiOS.
  if (/Messenger|Orca-Android/.test(ua)) return 'messenger';
  if (/FB_IAB|FBAN|FBAV/.test(ua)) return 'facebook';
  return null;
}

export const isAndroid = (ua: string): boolean => /Android/i.test(ua);

/** The address to send to Chrome: this page, without sign-in leftovers, the preview switch or a #fragment. */
export function pageToOpen(href: string): string {
  const url = new URL(cleanUrl(href));
  url.searchParams.delete('inapp');
  url.hash = '';
  return url.toString();
}

/**
 * An Android intent link that opens `href` in Chrome. The built-in browser hands intent:// links to Android,
 * which opens Chrome at the same address. With no fallback URL: if Chrome is missing, nothing happens and the
 * shopper still has Copy link.
 */
export function chromeIntentUrl(href: string): string {
  const url = new URL(pageToOpen(href));
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${url.protocol.replace(':', '')};package=com.android.chrome;end`;
}

/**
 * The built-in browser this page is open in. `?inapp` on the address previews the screen in a normal browser
 * (as `?facebook` and `?sponsor` do elsewhere).
 */
export function currentInAppBrowser(): InAppBrowser | null {
  if (typeof window === 'undefined') return null;
  if (new URLSearchParams(window.location.search).has('inapp')) return 'messenger';
  return detectInAppBrowser(navigator.userAgent ?? '');
}
