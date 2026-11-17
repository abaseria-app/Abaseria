// Shopper profile and consent switches (Profile task P2). Spec: project doc Abaseria_Shopper_Profile_Spec.md.
//
// Everything here lives in the database (migrations 015-017), never on the phone: the Profile screen loads it
// when opened and saves each change straight away. The database enforces the rules (own row only, real
// accounts only, answers need the profile switch, birth year locked once saved, under 18 refused); this file
// only shapes requests and turns database answers into something the screen can show. One exception: the budget
// range answer sets a starting monthly grocery budget on the phone (monthlyBudget.ts), which budgets already are.
import type { SupabaseClient } from '@supabase/supabase-js';
import { followProfileBand } from './monthlyBudget';
import { getSupabase } from './supabase';

/** Which privacy notice the shopper saw when they flipped a switch. Bump when the notice changes. */
export const POLICY_VERSION = '2026-11';

export type Purpose = 'profile' | 'offers' | 'research';
export type Consents = Record<Purpose, boolean>;
export const NO_CONSENTS: Consents = { profile: false, offers: false, research: false };

export const GENDERS = ['woman', 'man', 'another', 'no_answer'] as const;
export const HOUSEHOLD_SIZES = ['1', '2', '3-4', '5-6', '7+', 'no_answer'] as const;
export const YES_NO = ['yes', 'no', 'no_answer'] as const;
export const PAYDAYS = ['kinsenas_katapusan', 'weekly', 'monthly', 'daily_irregular', 'no_answer'] as const;
export const BUDGETS = ['under_3000', '3000_5999', '6000_9999', '10000_14999', '15000_plus', 'no_answer'] as const;

export interface Profile {
  nickname: string | null;
  birth_year: number | null;
  birthday_locked_at: string | null;
  gender: (typeof GENDERS)[number] | null;
  province_code: string | null;
  city_code: string | null;
  household_size_band: (typeof HOUSEHOLD_SIZES)[number] | null;
  has_kids_under_12: (typeof YES_NO)[number] | null;
  has_senior_60plus: (typeof YES_NO)[number] | null;
  payday_pattern: (typeof PAYDAYS)[number] | null;
  grocery_budget_band: (typeof BUDGETS)[number] | null;
}

/** The answers the screen can edit with chips, in the order they're shown. */
export type ChoiceField = 'gender' | 'household_size_band' | 'has_kids_under_12' | 'has_senior_60plus' | 'payday_pattern' | 'grocery_budget_band';
export const CHOICES: Record<ChoiceField, readonly string[]> = {
  gender: GENDERS,
  household_size_band: HOUSEHOLD_SIZES,
  has_kids_under_12: YES_NO,
  has_senior_60plus: YES_NO,
  payday_pattern: PAYDAYS,
  grocery_budget_band: BUDGETS,
};

export const EMPTY_PROFILE: Profile = {
  nickname: null,
  birth_year: null,
  birthday_locked_at: null,
  gender: null,
  province_code: null,
  city_code: null,
  household_size_band: null,
  has_kids_under_12: null,
  has_senior_60plus: null,
  payday_pattern: null,
  grocery_budget_band: null,
};

const PROFILE_COLUMNS =
  'nickname, birth_year, birthday_locked_at, gender, province_code, city_code, household_size_band, has_kids_under_12, has_senior_60plus, payday_pattern, grocery_budget_band';

/**
 * Birth years the app offers: from the year that is certainly 18+ (this year minus 19) back 100 years.
 * Someone born this year minus 18 may still be 17, and the database refuses that year until next year.
 * Years use Manila's calendar.
 */
export function birthYears(now: Date = new Date()): number[] {
  const manilaYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric' }).format(now));
  const newest = manilaYear - 19;
  return Array.from({ length: 82 }, (_, i) => newest - i);
}

/** The current switches from my_consents rows. A purpose with no row is off. */
export function consentsFromRows(rows: { purpose: string; granted: boolean }[] | null | undefined): Consents {
  const c: Consents = { ...NO_CONSENTS };
  for (const r of rows ?? []) if (r.purpose in c) c[r.purpose as Purpose] = !!r.granted;
  return c;
}

export type ProfileError = 'offline' | 'not_signed_in' | 'locked' | 'under_18' | 'needs_profile' | 'failed';

/** Turns a database error into something the screen can explain. */
export function explainError(e: { message?: string; code?: string } | null | undefined): ProfileError {
  const m = (e?.message ?? '').toLowerCase();
  if (m.includes('birthday is locked')) return 'locked';
  if (m.includes('under 18')) return 'under_18';
  if (m.includes('needs the profile switch') || m.includes('row-level security')) return 'needs_profile';
  if (m.includes('failed to fetch') || m.includes('network')) return 'offline';
  return 'failed';
}

export interface Loaded {
  consents: Consents;
  profile: Profile;
}

async function client(): Promise<SupabaseClient> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ProfileFailure('offline');
  const c = await getSupabase().catch(() => null);
  if (!c) throw new ProfileFailure('failed');
  const { data } = await c.auth.getSession();
  if (!data.session?.user || data.session.user.is_anonymous) throw new ProfileFailure('not_signed_in');
  return c;
}

export class ProfileFailure extends Error {
  reason: ProfileError;
  constructor(reason: ProfileError) {
    super(reason);
    this.reason = reason;
  }
}

function fail(e: { message?: string; code?: string } | null): never {
  throw new ProfileFailure(explainError(e));
}

/** The shopper's switches and answers. */
export async function loadProfile(): Promise<Loaded> {
  const c = await client();
  const [cons, prof] = await Promise.all([
    c.from('my_consents').select('purpose, granted'),
    c.from('shopper_profiles').select(PROFILE_COLUMNS).maybeSingle(),
  ]);
  if (cons.error) fail(cons.error);
  if (prof.error) fail(prof.error);
  const profile = { ...EMPTY_PROFILE, ...((prof.data as Partial<Profile> | null) ?? {}) };
  void followProfileBand(profile.grocery_budget_band);
  return { consents: consentsFromRows(cons.data), profile };
}

/** Flips one switch. The database turns offers and research off itself when profile goes off. */
export async function setConsent(purpose: Purpose, granted: boolean): Promise<Loaded> {
  const c = await client();
  const { error } = await c.from('consents').insert({ purpose, granted, policy_version: POLICY_VERSION });
  if (error) fail(error);
  return loadProfile();
}

export type Answer = Partial<Pick<Profile, 'nickname' | 'birth_year' | 'gender' | 'province_code' | 'city_code' | ChoiceField>>;

/** A nickname the database will accept (migration 019), or null if there's nothing usable. */
export function cleanNickname(raw: string): string | null {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30).trim();
  return s || null;
}

/** The monthly grocery budget on the phone follows the budget range answer (see monthlyBudget.ts). */
function saved(profile: Profile): Profile {
  void followProfileBand(profile.grocery_budget_band);
  return profile;
}

/** Saves (or clears, with null) answers: changes the shopper's row, or adds it the first time. */
export async function saveAnswers(answer: Answer): Promise<Profile> {
  const c = await client();
  const upd = await c.from('shopper_profiles').update(answer).not('user_id', 'is', null).select(PROFILE_COLUMNS);
  if (upd.error) fail(upd.error);
  if (!upd.data?.length) {
    const ins = await c.from('shopper_profiles').insert(answer).select(PROFILE_COLUMNS).single();
    if (ins.error) fail(ins.error);
    return saved({ ...EMPTY_PROFILE, ...(ins.data as Partial<Profile>) });
  }
  return saved({ ...EMPTY_PROFILE, ...(upd.data[0] as Partial<Profile>) });
}

/** Deletes every answer (the switches stay as they are). */
export async function deleteAnswers(): Promise<void> {
  const c = await client();
  const { error } = await c.from('shopper_profiles').delete().not('user_id', 'is', null);
  if (error) fail(error);
  void followProfileBand(null);
}
