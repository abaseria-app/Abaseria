// Shopper sign-in. Every shopper signs in with Google before their first trip (decided Nov 6, 2026).
//
// Why the app keeps its own "signed in as" record on the phone: Supabase's session needs the internet to
// refresh, and a shopper in a mall basement must still be able to open the app. The record is only a door
// for the screens; what anyone can add to the shared database is still decided by its rules (schema.sql).
//
// Phones that signed in anonymously before this (the dev test phones) keep the same user id when they pick
// Google, so the prices they already shared stay credited to them. If that Google account already belongs to
// another Abaseria user, the phone signs in to that user instead.
//
// Trips stay on the phone either way: signing in or out doesn't move or delete them (that's feature 28).
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSetting, setSetting } from './db';
import { dbConfig, getSupabase } from './supabase';

/** Builds without a database stay phone-only and need no sign-in. */
export const LOGIN_REQUIRED = !!dbConfig;

export interface Account {
  id: string;
  name: string | null;
  email: string | null;
}

const ACCOUNT_KEY = 'account';

// ---------------------------------------------------------------------------------------------------------
// Pure helpers (tested in auth.test.ts)

/** A real account from a Supabase user, or null for an anonymous one. */
export function accountFromUser(user: User | null | undefined): Account | null {
  if (!user || user.is_anonymous) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string' && !!v.trim()) ?? null;
  return { id: user.id, name: name?.trim() ?? null, email: user.email ?? null };
}

/** Where Google sends the shopper back to: the app's own address, so /Abaseria/ and /Abaseria/dev/ each return home. */
export function redirectUrl(origin: string, base: string): string {
  return origin + (base.startsWith('/') ? base : `/${base}`);
}

export interface ReturnInfo {
  /** Google or Supabase sent the shopper back with a code to finish signing in. */
  finishing: boolean;
  error: string | null;
  code: string | null;
}

/** Reads what the sign-in page put in the address when it sent the shopper back. */
export function readReturn(href: string): ReturnInfo {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const get = (k: string) => url.searchParams.get(k) ?? hash.get(k);
  const error = get('error_description') ?? get('error');
  return {
    finishing: !!get('code') || !!hash.get('access_token'),
    error: error ? error.replace(/\+/g, ' ') : null,
    code: get('error_code'),
  };
}

/** The address with the sign-in leftovers removed, so a reload doesn't try to finish twice. */
export function cleanUrl(href: string): string {
  const url = new URL(href);
  for (const k of ['code', 'error', 'error_code', 'error_description', 'state']) url.searchParams.delete(k);
  if (/(access_token|error)=/.test(url.hash)) url.hash = '';
  return url.toString();
}

// ---------------------------------------------------------------------------------------------------------
// The phone's record

export async function savedAccount(): Promise<Account | null> {
  const raw = await getSetting(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Account;
    return a?.id ? a : null;
  } catch {
    return null;
  }
}

async function save(account: Account | null): Promise<void> {
  await setSetting(ACCOUNT_KEY, account ? JSON.stringify(account) : '');
}

type Listener = (account: Account | null) => void;
const listeners = new Set<Listener>();

/** Tells the screens when the shopper signs in or is signed out (for example, their account was removed). */
export function onAccountChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(account: Account | null) {
  for (const fn of listeners) fn(account);
}

// ---------------------------------------------------------------------------------------------------------
// Network

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export type StartResult = { ok: true } | { ok: false; reason: 'offline' | 'off' | 'failed'; message?: string };

/** Sends the shopper to Google. The page leaves the app; it comes back to `redirectUrl`. */
export async function startGoogle(): Promise<StartResult> {
  if (!online()) return { ok: false, reason: 'offline' };
  const client = await getSupabase();
  if (!client) return { ok: false, reason: 'off' };
  const redirectTo = redirectUrl(window.location.origin, import.meta.env.BASE_URL);
  const { data } = await client.auth.getSession();
  // A phone that already shares prices anonymously keeps its user id by adding Google to it.
  const { error } = data.session?.user?.is_anonymous
    ? await client.auth.linkIdentity({ provider: 'google', options: { redirectTo } })
    : await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } });
  return error ? { ok: false, reason: 'failed', message: error.message } : { ok: true };
}

let started: Promise<InitResult> | null = null;

export interface InitResult {
  account: Account | null;
  /** Shown on the sign-in screen when the return from Google didn't work. */
  error: string | null;
  /** The app is on its way back to Google (switching from an anonymous phone to an existing account). */
  redirecting: boolean;
}

/**
 * Runs once per app open: finishes a sign-in coming back from Google, checks the phone's record against
 * Supabase when online, and listens for sign-outs. Offline it trusts the phone's record.
 */
export function initAuth(): Promise<InitResult> {
  started ??= init();
  return started;
}

async function init(): Promise<InitResult> {
  const back = typeof window !== 'undefined' ? readReturn(window.location.href) : { finishing: false, error: null, code: null };
  let saved = await savedAccount();
  if (!LOGIN_REQUIRED) return { account: saved, error: null, redirecting: false };

  // Only load the database library early when it's needed: a return from Google, or no record yet.
  if (saved && !back.finishing && !back.error && !online()) return { account: saved, error: null, redirecting: false };

  let client: SupabaseClient | null;
  try {
    client = await getSupabase();
  } catch {
    return { account: saved, error: null, redirecting: false };
  }
  if (!client) return { account: saved, error: null, redirecting: false };

  // getSession waits for the library to finish the sign-in code in the address, if there is one.
  const { data, error } = await client.auth.getSession();
  if (back.finishing || back.error) window.history.replaceState(null, '', cleanUrl(window.location.href));

  // That Google account already belongs to another Abaseria user: sign in to that one instead.
  if (back.code === 'identity_already_exists' && data.session?.user?.is_anonymous) {
    await client.auth.signOut({ scope: 'local' });
    const again = await startGoogle();
    if (again.ok) return { account: null, error: null, redirecting: true };
  }

  const fromSession = accountFromUser(data.session?.user);
  if (fromSession) {
    saved = fromSession;
    await save(saved);
  } else if (saved && !error && online()) {
    // Online, no error, and no real session: it was signed out elsewhere or the account was removed.
    saved = null;
    await save(null);
  }

  client.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
    // Supabase's own listener must not wait on other work, so the phone's record updates after it returns.
    setTimeout(async () => {
      if (event === 'SIGNED_OUT') {
        await save(null);
        announce(null);
        return;
      }
      const a = accountFromUser(session?.user);
      if (a && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
        await save(a);
        announce(a);
      }
    }, 0);
  });

  return { account: saved, error: back.error, redirecting: false };
}

/** Signs out on this phone only. Trips and saved stores stay. */
export async function signOut(): Promise<void> {
  await save(null);
  const client = await getSupabase().catch(() => null);
  if (client) await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  announce(null);
}

/** For uploads: true when there's a real (not anonymous) session to send prices with. */
export async function hasAccountSession(client: SupabaseClient): Promise<boolean> {
  const { data } = await client.auth.getSession();
  return !!accountFromUser(data.session?.user);
}
