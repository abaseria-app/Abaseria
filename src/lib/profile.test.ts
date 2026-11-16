import { describe, expect, it } from 'vitest';
import { birthYears, consentsFromRows, explainError } from './profile';

describe('birthYears', () => {
  it('starts at the newest year that is certainly 18+', () => {
    const years = birthYears(new Date('2026-11-16T12:00:00+08:00'));
    expect(years[0]).toBe(2007);
    expect(years).not.toContain(2008);
    expect(years.at(-1)).toBe(1926);
  });

  it('uses Manila’s year on New Year’s Eve UTC', () => {
    // 4 pm UTC on Dec 31 is already Jan 1 in Manila.
    expect(birthYears(new Date('2026-12-31T16:30:00Z'))[0]).toBe(2008);
  });
});

describe('consentsFromRows', () => {
  it('is all off with no rows', () => {
    expect(consentsFromRows([])).toEqual({ profile: false, offers: false, research: false });
    expect(consentsFromRows(null)).toEqual({ profile: false, offers: false, research: false });
  });

  it('reads the current switches and ignores price_sharing', () => {
    expect(
      consentsFromRows([
        { purpose: 'profile', granted: true },
        { purpose: 'research', granted: true },
        { purpose: 'price_sharing', granted: false },
      ]),
    ).toEqual({ profile: true, offers: false, research: true });
  });
});

describe('explainError', () => {
  it('names the database rules', () => {
    expect(explainError({ message: 'birthday is locked; contact support to correct it' })).toBe('locked');
    expect(explainError({ message: 'under 18: no profile answers are stored' })).toBe('under_18');
    expect(explainError({ message: 'offers needs the profile switch on first' })).toBe('needs_profile');
    expect(explainError({ message: 'new row violates row-level security policy for table "shopper_profiles"' })).toBe('needs_profile');
    expect(explainError({ message: 'TypeError: Failed to fetch' })).toBe('offline');
    expect(explainError({ message: 'something else' })).toBe('failed');
    expect(explainError(null)).toBe('failed');
  });
});
