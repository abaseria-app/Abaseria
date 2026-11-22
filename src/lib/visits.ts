// Which profile questions to ask on open (Shopper Profile Spec, section 4).
//
// A visit is the app opened while signed in on a new calendar day, Manila time. Sign-in itself rarely repeats,
// so logins aren't counted. Counted on the phone, per account.
//   2nd visit: the "get to know you" popups (nickname, birth year, gender)
//   3rd visit: the household popups (household size, kids, seniors, payday, budget)
// Each set is shown once. Anything skipped stays on the Profile tab.
import { getSetting, setSetting } from './db';

export type QuestionSet = 'basics' | 'household';

export interface VisitState {
  days: number;
  last: string | null;
  shown: QuestionSet[];
  /** The day the basics popups were shown; household never comes the same day. */
  basicsDay: string | null;
}

const EMPTY: VisitState = { days: 0, last: null, shown: [], basicsDay: null };
const key = (userId: string) => `visits:${userId}`;

/** Today's date in Manila, as YYYY-MM-DD. */
export function manilaDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Counts today as a visit if it's a new day. */
export function countVisit(state: VisitState, today: string): VisitState {
  return state.last === today ? state : { ...state, days: state.days + 1, last: today };
}

/** The set due now, if any: basics from the 2nd visit, household from the 3rd, each once and in that order. */
export function dueSet(state: VisitState): QuestionSet | null {
  if (state.days >= 2 && !state.shown.includes('basics')) return 'basics';
  if (state.days >= 3 && state.shown.includes('basics') && !state.shown.includes('household')) {
    // Never two sets on the same day: household waits for a later visit than the one that showed basics.
    return state.basicsDay !== state.last ? 'household' : null;
  }
  return null;
}

export function parseVisits(raw: string | null): VisitState {
  try {
    const v = JSON.parse(raw ?? '') as Partial<VisitState>;
    return {
      days: Number.isFinite(v.days) ? Number(v.days) : 0,
      last: typeof v.last === 'string' ? v.last : null,
      shown: Array.isArray(v.shown) ? v.shown.filter((s): s is QuestionSet => s === 'basics' || s === 'household') : [],
      basicsDay: typeof v.basicsDay === 'string' ? v.basicsDay : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Records today's visit and says which set (if any) is due. Call once when the signed-in app opens. */
export async function recordVisit(userId: string, now: Date = new Date()): Promise<QuestionSet | null> {
  const state = countVisit(parseVisits(await getSetting(key(userId))), manilaDay(now));
  await setSetting(key(userId), JSON.stringify(state));
  return dueSet(state);
}

/** Marks a set as shown, so it isn't asked again on this phone. */
export async function markShown(userId: string, set: QuestionSet, now: Date = new Date()): Promise<void> {
  const state = parseVisits(await getSetting(key(userId)));
  if (!state.shown.includes(set)) state.shown.push(set);
  if (set === 'basics') state.basicsDay = manilaDay(now);
  await setSetting(key(userId), JSON.stringify(state));
}
