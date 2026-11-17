import { describe, expect, it } from 'vitest';
import { countVisit, dueSet, manilaDay, parseVisits, type VisitState } from './visits';

const fresh: VisitState = { days: 0, last: null, shown: [], basicsDay: null };

describe('manilaDay', () => {
  it('uses Manila’s date', () => {
    expect(manilaDay(new Date('2026-11-16T15:59:00Z'))).toBe('2026-11-16');
    expect(manilaDay(new Date('2026-11-16T16:01:00Z'))).toBe('2026-11-17');
  });
});

describe('countVisit', () => {
  it('counts a new day once', () => {
    const a = countVisit(fresh, '2026-11-16');
    expect(a.days).toBe(1);
    expect(countVisit(a, '2026-11-16').days).toBe(1);
    expect(countVisit(a, '2026-11-17').days).toBe(2);
  });
});

describe('dueSet', () => {
  it('asks nothing on the first visit', () => {
    expect(dueSet({ ...fresh, days: 1, last: 'd1' })).toBeNull();
  });
  it('asks the basics on the 2nd visit, once', () => {
    expect(dueSet({ ...fresh, days: 2, last: 'd2' })).toBe('basics');
    expect(dueSet({ ...fresh, days: 2, last: 'd2', shown: ['basics'], basicsDay: 'd2' })).toBeNull();
  });
  it('asks the household on the 3rd visit, once', () => {
    expect(dueSet({ days: 3, last: 'd3', shown: ['basics'], basicsDay: 'd2' })).toBe('household');
    expect(dueSet({ days: 3, last: 'd3', shown: ['basics', 'household'], basicsDay: 'd2' })).toBeNull();
  });
  it('never shows both sets on the same day', () => {
    // A shopper whose 2nd counted visit was missed (offline) gets basics on visit 3, household on a later day.
    expect(dueSet({ ...fresh, days: 3, last: 'd3' })).toBe('basics');
    expect(dueSet({ days: 3, last: 'd3', shown: ['basics'], basicsDay: 'd3' })).toBeNull();
    expect(dueSet({ days: 4, last: 'd4', shown: ['basics'], basicsDay: 'd3' })).toBe('household');
  });
});

describe('parseVisits', () => {
  it('survives junk', () => {
    expect(parseVisits(null)).toEqual(fresh);
    expect(parseVisits('{bad')).toEqual(fresh);
    expect(parseVisits('{"days":2,"last":"d2","shown":["basics","x"],"basicsDay":"d2"}')).toEqual({ days: 2, last: 'd2', shown: ['basics'], basicsDay: 'd2' });
  });
});
