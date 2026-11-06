// Connection to the shared price database (Supabase).
//
// There are two databases: "dev" for building and testing, "prod" for real shoppers. Each build is told
// which one it's talking to through VITE_SUPABASE_ENV, and the label has to match the build:
// `npm run dev` only connects to a database labeled dev, a production build only to one labeled prod.
// That stops test scans from landing in the real price data by accident.
//
// With no keys set, `dbConfig` is null and the app works exactly as before: everything stays on the phone.
import type { SupabaseClient } from '@supabase/supabase-js';

export type DbTarget = 'dev' | 'prod';

export interface DbConfig {
  url: string;
  /** The publishable (anon) key. Safe to ship in the app; row-level security does the protecting. */
  key: string;
  target: DbTarget;
}

export interface EnvLike {
  MODE?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ENV?: string;
}

/** Null when keys are missing, malformed, or labeled for the other kind of build. */
export function resolveConfig(env: EnvLike): DbConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const target = env.VITE_SUPABASE_ENV?.trim();
  if (!url || !key) return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) return null;
  // A secret key bypasses every rule in schema.sql. Refuse it even if someone pastes it in by mistake.
  if (key.startsWith('sb_secret_') || isServiceRoleJwt(key)) return null;
  const wanted: DbTarget = env.MODE === 'production' ? 'prod' : 'dev';
  if (target !== wanted) return null;
  return { url: url.replace(/\/$/, ''), key, target };
}

/** Old-style keys are JWTs; the service_role one carries role "service_role". */
function isServiceRoleJwt(key: string): boolean {
  const part = key.split('.')[1];
  if (!part) return false;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return json?.role === 'service_role';
  } catch {
    return false;
  }
}

export const dbConfig = resolveConfig(import.meta.env as EnvLike);

let clientPromise: Promise<SupabaseClient | null> | null = null;

/**
 * The client, or null when no database is set up. The library (about 200 KB) loads on first use,
 * so it doesn't slow down opening the app.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!dbConfig) return Promise.resolve(null);
  const { url, key } = dbConfig;
  // PKCE: Google sends back a one-time code (not the tokens themselves) that only this phone can redeem.
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } }),
  );
  return clientPromise;
}

export type DbStatus =
  | { state: 'off' }
  | { state: 'ok'; target: DbTarget; branches: number; products: number; prices: number }
  | { state: 'error'; target: DbTarget; message: string };

/** Counts rows in each table. Read-only; works logged out. */
export async function checkConnection(): Promise<DbStatus> {
  if (!dbConfig) return { state: 'off' };
  const target = dbConfig.target;
  let client: SupabaseClient | null;
  try {
    client = await getSupabase();
  } catch {
    clientPromise = null; // let the next tap try loading again
    return { state: 'error', target, message: 'could not load the database library' };
  }
  if (!client) return { state: 'off' };
  const db = client;
  // No retries: offline, the client would wait 1 + 2 + 4 seconds before giving up, and this is a quick check.
  const count = async (table: string) => {
    const { count: n, error } = await db.from(table).select('*', { count: 'exact', head: true }).retry(false);
    if (error) throw new Error(error.message || error.code || 'unknown error');
    return n ?? 0;
  };
  try {
    const [branches, products, prices] = await Promise.all([count('branches'), count('products'), count('latest_prices')]);
    return { state: 'ok', target, branches, products, prices };
  } catch (e) {
    return { state: 'error', target, message: e instanceof Error ? e.message : String(e) };
  }
}
