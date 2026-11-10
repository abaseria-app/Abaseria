import { describe, expect, it } from 'vitest';
import { BOOKED_SPONSORS, activeSponsor, localDay, shouldShowSponsor, type Sponsor } from './sponsor';

const s = (id: string, startsOn: string, endsOn: string): Sponsor => ({ id, imageUrl: 'x.webp', alt: id, linkUrl: null, startsOn, endsOn });

describe('activeSponsor', () => {
  it('finds the sponsor whose run covers today, ends inclusive', () => {
    const list = [s('nov', '2026-11-01', '2026-11-30'), s('dec', '2026-12-01', '2026-12-31')];
    expect(activeSponsor(list, '2026-11-01')?.id).toBe('nov');
    expect(activeSponsor(list, '2026-11-30')?.id).toBe('nov');
    expect(activeSponsor(list, '2026-12-15')?.id).toBe('dec');
    expect(activeSponsor(list, '2027-01-01')).toBeNull();
  });

  it('is null while nothing is booked', () => {
    expect(BOOKED_SPONSORS).toHaveLength(0);
    expect(activeSponsor(BOOKED_SPONSORS, '2026-11-11')).toBeNull();
  });
});

describe('shouldShowSponsor', () => {
  const sponsor = s('nov', '2026-11-01', '2026-11-30');
  const today = '2026-11-11';

  it('shows once a day when a sponsor is booked', () => {
    expect(shouldShowSponsor({ sponsor, tripActive: false, lastShownDay: null, today })).toBe(true);
    expect(shouldShowSponsor({ sponsor, tripActive: false, lastShownDay: '2026-11-10', today })).toBe(true);
    expect(shouldShowSponsor({ sponsor, tripActive: false, lastShownDay: today, today })).toBe(false);
  });

  it('never shows without a sponsor', () => {
    expect(shouldShowSponsor({ sponsor: null, tripActive: false, lastShownDay: null, today })).toBe(false);
  });

  it('never shows mid-trip', () => {
    expect(shouldShowSponsor({ sponsor, tripActive: true, lastShownDay: null, today })).toBe(false);
  });
});

describe('localDay', () => {
  it('formats the local date', () => {
    expect(localDay(new Date(2026, 10, 1, 23, 59))).toBe('2026-11-01');
  });
});
