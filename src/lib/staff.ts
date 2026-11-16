// Staff roles (Module 2, Task 2). The database decides who is staff (public.staff, migration 013); the app
// only asks "what's my role?" through staff_role() and shows it. Task 3 uses the same answer to show
// collector mode.
//
// The phone keeps the last answer, tagged with the account it belongs to, so the role still shows in a
// store with no signal and never carries over to another account signed in on the same phone. Showing a
// role is cosmetic: what a staff member can actually do is checked by the database every time.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSetting, setSetting } from './db';
import { getSupabase } from './supabase';
import { S } from '../strings';

export type StaffRole = 'admin' | 'product_manager' | 'data_entry';

const KEY = 'staffRole';

export const isStaffRole = (v: unknown): v is StaffRole => v === 'admin' || v === 'product_manager' || v === 'data_entry';

/** "Admin", "Product Manager" or "Collector" (data_entry is called Collector in the app). */
export function roleLabel(role: StaffRole): string {
  return S.staff.roles[role];
}

/** The saved role for this account, or null if the saved one belongs to someone else or isn't a role. */
export function parseSaved(raw: string | null, accountId: string): StaffRole | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { id?: unknown; role?: unknown };
    return v?.id === accountId && isStaffRole(v.role) ? v.role : null;
  } catch {
    return null;
  }
}

export async function savedStaffRole(accountId: string): Promise<StaffRole | null> {
  return parseSaved(await getSetting(KEY), accountId);
}

/** Asks the database. Undefined means it couldn't answer (offline, no database): keep what's saved. */
export async function fetchStaffRole(client: SupabaseClient): Promise<StaffRole | null | undefined> {
  const { data, error } = await client.rpc('staff_role');
  if (error) return undefined;
  return isStaffRole(data) ? data : null;
}

/** The role to show for this account: the database's answer when online, otherwise the phone's copy. */
export async function refreshStaffRole(accountId: string): Promise<StaffRole | null> {
  const saved = await savedStaffRole(accountId);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return saved;
  const client = await getSupabase().catch(() => null);
  if (!client) return saved;
  const { data } = await client.auth.getSession();
  if (data.session?.user?.id !== accountId) return saved;
  const fresh = await fetchStaffRole(client).catch(() => undefined);
  if (fresh === undefined) return saved;
  await setSetting(KEY, fresh ? JSON.stringify({ id: accountId, role: fresh }) : '');
  return fresh;
}
