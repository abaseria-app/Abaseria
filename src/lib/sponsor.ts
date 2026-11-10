// The launch popup is for sponsors Abaseria sells directly, never AdMob. It shows only while a sponsor is booked,
// at most once a day, and never while a trip is in progress (the shopper is in the aisle and wants the list).
//
// Booking a sponsor today means adding an entry to BOOKED_SPONSORS and releasing. When the admin dashboard
// exists this list moves to a Supabase table with the same fields.

export interface Sponsor {
  id: string;
  /** The 3:5 portrait creative, 600 × 1000. Null draws the placeholder card (dev preview only). */
  imageUrl: string | null;
  /** What the image says, for screen readers. */
  alt: string;
  /** Where a tap on the creative goes. Null = not tappable. */
  linkUrl: string | null;
  /** First and last day it runs, inclusive, as YYYY-MM-DD in the phone's local time. */
  startsOn: string;
  endsOn: string;
}

/** No sponsor is booked, so the popup never shows. */
export const BOOKED_SPONSORS: Sponsor[] = [];

/** Placeholder used by the dev app when the address ends in ?sponsor, so the popup can be checked on a phone. */
export const PREVIEW_SPONSOR: Sponsor = {
  id: 'preview',
  imageUrl: null,
  alt: 'Sponsor creative placeholder',
  linkUrl: null,
  startsOn: '2000-01-01',
  endsOn: '2999-12-31',
};

/** The phone's local date as YYYY-MM-DD. */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The first sponsor whose run covers today, or null. */
export function activeSponsor(list: Sponsor[], today: string): Sponsor | null {
  return list.find((s) => s.startsOn <= today && today <= s.endsOn) ?? null;
}

export function shouldShowSponsor(opts: {
  sponsor: Sponsor | null;
  tripActive: boolean;
  /** The day the popup last showed on this phone, or null if never. */
  lastShownDay: string | null;
  today: string;
}): boolean {
  if (!opts.sponsor) return false;
  if (opts.tripActive) return false;
  return opts.lastShownDay !== opts.today;
}
