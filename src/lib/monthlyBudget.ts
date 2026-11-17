// The shopper's monthly grocery budget, kept on the phone like trips (privacy page: budgets never leave the phone).
//
// It starts from the profile's budget answer (₱1,000 to ₱15,000+, migration 020), and the shopper can type
// their own amount when starting a trip. Their own amount wins from then on. A new trip suggests what's
// left this month: the monthly budget minus this month's finished trips.
import type { Item, Trip } from './db';
import { getSetting, setSetting } from './db';
import { manilaDay } from './visits';

export interface MonthlyBudget {
  centavos: number;
  /** 'profile': from the budget range answer. 'shopper': typed by the shopper, never overwritten by the profile. */
  source: 'profile' | 'shopper';
}

const KEY = 'monthlyBudget';

export function parseBudget(raw: string | null): MonthlyBudget | null {
  try {
    const v = JSON.parse(raw ?? '') as Partial<MonthlyBudget>;
    if (typeof v.centavos === 'number' && v.centavos > 0 && (v.source === 'profile' || v.source === 'shopper')) {
      return { centavos: Math.round(v.centavos), source: v.source };
    }
  } catch {
    /* nothing saved */
  }
  return null;
}

/** What to store after the profile's budget answer (in pesos) is read or changed. Undefined: leave it alone. */
export function nextFromProfile(current: MonthlyBudget | null, pesos: number | null | undefined): MonthlyBudget | null | undefined {
  if (current?.source === 'shopper') return undefined;
  const centavos = pesos && pesos > 0 ? Math.round(pesos) * 100 : null;
  if (centavos) return current?.centavos === centavos ? undefined : { centavos, source: 'profile' };
  // The answer was removed (or the profile switched off): drop the amount that came from it.
  return current ? null : undefined;
}

export async function loadMonthlyBudget(): Promise<MonthlyBudget | null> {
  return parseBudget(await getSetting(KEY));
}

/** The shopper's own amount; null clears it. */
export async function setMonthlyBudget(centavos: number | null): Promise<void> {
  await setSetting(KEY, centavos && centavos > 0 ? JSON.stringify({ centavos, source: 'shopper' }) : '');
}

/** Called whenever the profile is loaded or saved. Never throws: budgeting is a convenience, not part of the save. */
export async function followProfileBudget(pesos: number | null | undefined): Promise<void> {
  try {
    const next = nextFromProfile(await loadMonthlyBudget(), pesos);
    if (next !== undefined) await setSetting(KEY, next ? JSON.stringify(next) : '');
  } catch {
    /* storage unavailable: the trip screen simply shows no suggestion */
  }
}

/**
 * Spent on groceries this calendar month (Manila), counted the way the Cart tab counts: finished, not cancelled,
 * by start date, receipt total when entered, otherwise the app's tally.
 */
export function spentThisMonth(trips: Trip[], items: Item[], now: Date = new Date()): number {
  const month = manilaDay(now).slice(0, 7);
  const tally = new Map<number, number>();
  for (const i of items) if (!i.removed) tally.set(i.tripId, (tally.get(i.tripId) ?? 0) + i.lineTotalCentavos);
  return trips
    .filter((t) => t.endedAt && !t.cancelledAt && manilaDay(new Date(t.startedAt)).slice(0, 7) === month)
    .reduce((sum, t) => sum + (t.receiptTotalCentavos ?? tally.get(t.id!) ?? 0), 0);
}
