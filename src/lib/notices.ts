// Notices from Abaseria to every shopper (public.notices, migration 011): a heads-up, or the breach notice the
// Breach Plan calls for. Brad adds rows in the Supabase dashboard; the database only serves the ones running now.
// Shown as a banner on open. Closing one hides it on this phone; an incident notice comes back each time the app
// opens until its end date, so nobody misses it.
import { getSetting, setSetting } from './db';
import { getSupabase } from './supabase';

export interface Notice {
  id: number;
  kind: 'info' | 'incident';
  title_en: string;
  body_en: string;
  title_tl: string | null;
  body_tl: string | null;
}

const DISMISSED = 'dismissedNotices';

/** Newest incident first, then newest info; dismissed info notices left out. Incidents can't be dismissed for good. */
export function visibleNotices(all: Notice[], dismissed: number[]): Notice[] {
  return all
    .filter((n) => n.kind === 'incident' || !dismissed.includes(n.id))
    .sort((a, b) => (a.kind === b.kind ? b.id - a.id : a.kind === 'incident' ? -1 : 1));
}

export async function dismissedNotices(): Promise<number[]> {
  try {
    const v = JSON.parse((await getSetting(DISMISSED)) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

export async function dismissNotice(id: number): Promise<void> {
  const list = await dismissedNotices();
  if (!list.includes(id)) await setSetting(DISMISSED, JSON.stringify([...list, id].slice(-50)));
}

/** Current notices for this phone. Empty when offline or with no database: a notice is never worth blocking the app. */
export async function loadNotices(): Promise<Notice[]> {
  try {
    const client = await getSupabase();
    if (!client) return [];
    const { data, error } = await client
      .from('notices')
      .select('id, kind, title_en, body_en, title_tl, body_tl')
      .order('id', { ascending: false })
      .limit(5)
      .retry(false);
    if (error || !data) return [];
    return visibleNotices(data as Notice[], await dismissedNotices());
  } catch {
    return [];
  }
}
