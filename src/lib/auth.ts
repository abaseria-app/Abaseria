// Shopper sign-in. Every shopper signs in with Google or Facebook before their first trip (Google decided
// Nov 6, 2026; Facebook added Nov 7). A Facebook account with no email on it can't sign in: Supabase needs
// an email from the provider and refuses the sign-in without one, so the shopper is told to use Google.
//
// Why the app keeps its own "signed in as" record on the phone: Supabase's session needs the internet to
// refresh, and a shopper in a mall basement must still be able to open the app. The record is only a door
// for the screens; what anyone can add to the shared database is still decided by its rules (schema.sql).
//
// Phones that signed in anonymously before this (the dev test phones) keep the same user id when they pick
// a provider, so the prices they already shared stay credited to them. If that account already belongs to
// another Abaseria user, the phone signs in to that user instead.
//
// Trips stay on the phone either way: signing in or out doesn't move or delete them (that's feature 28).
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSetting, setSetting } from './db';
import { dbConfig, getSupabase } from './supabase';

/** Builds without a database stay phone-only and need no sign-in. */
export const LOGIN_REQUIRED = !!dbConfig;

export type Provider = 'google' | 'facebook';

export interface Account {
  id: string;
  name: string | null;
  email: string | null;
}

const ACCOUNT_KEY = 'account';
/** Which button the shopper last tapped, so a retry after the redirect goes back to the same provider. */
const PROVIDER_KEY = 'loginProvider';

// ---------------------------------------------------------------------------------------------------------
// Pure helpers (tested in auth.test.ts)

/** A real account from a Supabase user, or null for an anonymous one. */
export function accountFromUser(user: User | null | undefined): Account | null {
  if (!user || user.is_anonymous) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string' && !!v.trim()) ?? null;
  return { id: user.id, name: name?.trim() ?? null, email: user.email ?? null };
}

/** A link attempt that can't work however often it's retried, so the phone signs in on its own instead. */
export function shouldStartFresh(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'manual_linking_disabled' || /manual linking is disabled/i.test(error.message ?? '');
}

/** Where Google or Facebook sends the shopper back to: the app's own address, so /Abaseria/ and /Abaseria/dev/ each return home. */
export function redirectUrl(origin: string, base: string): string {
  return origin + (base.startsWith('/') ? base : `/${base}`);
}

export interface ReturnInfo {
  /** Google, Facebook or Supabase sent the shopper back with a code to finish signing in. */
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
  // Facebook tacks "#_=_" onto every return address.
  if (/(access_token|error)=/.test(url.hash) || url.hash === '#_=_') url.hash = '';
  return url.toString();
}

/** The Facebook account has no email on it (often one made with a mobile number), so Supabase refused it. */
export function isMissingEmail(error: string | null | undefined): boolean {
  return /getting user email from external provider/i.test(error ?? '');
}

export const isProvider = (v: unknown): v is Provider => v === 'google' || v === 'facebook';

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

/** Sends the shopper to Google or Facebook. The page leaves the app; it comes back to `redirectUrl`. */
export async function startSignIn(provider: Provider): Promise<StartResult> {
  if (!online()) return { ok: false, reason: 'offline' };
  const client = await getSupabase();
  if (!client) return { ok: false, reason: 'off' };
  await setSetting(PROVIDER_KEY, provider);
  const redirectTo = redirectUrl(window.location.origin, import.meta.env.BASE_URL);
  // Google: always show the account picker. Facebook: ask for email again if the shopper unticked it last time.
  const queryParams: Record<string, string> =
    provider === 'google' ? { prompt: 'select_account' } : { auth_type: 'rerequest' };
  const scopes = provider === 'facebook' ? 'email public_profile' : undefined;
  const signIn = () => client.auth.signInWithOAuth({ provider, options: { redirectTo, queryParams, scopes } });
  const { data } = await client.auth.getSession();
  if (data.session?.user?.is_anonymous) {
    // A phone that already shares prices anonymously keeps its user id by adding the account to it.
    const linked = await client.auth.linkIdentity({ provider, options: { redirectTo, queryParams, scopes } });
    if (!linked.error) return { ok: true };
    // Linking is switched off in Supabase: start fresh rather than leave the shopper stuck.
    if (!shouldStartFresh(linked.error)) return { ok: false, reason: 'failed', message: linked.error.message };
    await client.auth.signOut({ scope: 'local' });
  }
  const { error } = await signIn();
  return error ? { ok: false, reason: 'failed', message: error.message } : { ok: true };
}

/** The provider the shopper last tapped on this phone, if any. */
export async function lastProvider(): Promise<Provider | null> {
  const v = await getSetting(PROVIDER_KEY);
  return isProvider(v) ? v : null;
}

let started: Promise<InitResult> | null = null;

export interface InitResult {
  account: Account | null;
  /** Shown on the sign-in screen when the return from Google or Facebook didn't work. */
  error: string | null;
  /** The app is on its way back to the provider (switching from an anonymous phone to an existing account). */
  redirecting: boolean;
}

/**
 * Runs once per app open: finishes a sign-in coming back from Google or Facebook, checks the phone's record against
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

  // Only load the database library early when it's needed: a return from sign-in, or no record yet.
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

  // That account already belongs to another Abaseria user: sign in to that one instead.
  if (back.code === 'identity_already_exists' && data.session?.user?.is_anonymous) {
    await client.auth.signOut({ scope: 'local' });
    const again = await startSignIn((await lastProvider()) ?? 'google');
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

// ---------------------------------------------------------------------------------------------------------
// Email code sign-in (Nov 13, 2026). For shoppers who'd rather not use Google: Supabase emails a 6-digit code
// (sent through the Abaseria Gmail until there's a domain) and the shopper types it in. A code, not a link,
// because a link in the email opens in whatever browser the mail app picks, which isn't the app, and the
// sign-in can't finish there. Codes also work inside Messenger's and Facebook's browsers, where Google doesn't.
//
// The same email on Google and on a code is one account: Supabase links identities with the same verified email.

/** How long a code stays usable, matching Email OTP Expiration in Supabase (README). */
export const CODE_MINUTES = 10;
const PENDING_KEY = 'emailCodePending';

/** Trimmed and lower-cased, so "Juan@Gmail.com " and "juan@gmail.com" are the same account. */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

/** A plausible address: something@something.tld, no spaces. The real check is whether the code arrives. */
export const isEmail = (raw: string): boolean => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(raw.trim());

/** Just the digits, at most 6: pasted codes often bring spaces or a trailing newline. */
export const cleanCode = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6);

export interface PendingCode {
  email: string;
  sentAt: number;
}

/**
 * The address a code was sent to, if it's still usable. Kept on the phone because Android often closes the
 * app while the shopper is in Gmail reading the code; when they come back, the code box is still there.
 */
export function parsePending(raw: string | null, now: number): PendingCode | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingCode>;
    if (typeof p.email !== 'string' || typeof p.sentAt !== 'number') return null;
    return now - p.sentAt < CODE_MINUTES * 60_000 ? { email: p.email, sentAt: p.sentAt } : null;
  } catch {
    return null;
  }
}

export type CodeProblem = 'offline' | 'off' | 'wait' | 'tooMany' | 'badCode' | 'badEmail' | 'failed';

/** Sorts Supabase's error messages into the few things a shopper can act on. */
export function codeProblem(error: { message?: string; code?: string; status?: number } | null | undefined): CodeProblem {
  const m = error?.message ?? '';
  const c = error?.code ?? '';
  if (c === 'over_email_send_rate_limit' || /only request this after|security purposes/i.test(m)) return 'wait';
  if (c === 'over_request_rate_limit' || error?.status === 429 || /rate limit/i.test(m)) return 'tooMany';
  if (c === 'otp_expired' || /expired|invalid.*(token|otp)|token.*invalid/i.test(m)) return 'badCode';
  if (c === 'email_address_invalid' || c === 'validation_failed' || /invalid.*email|email.*invalid/i.test(m)) return 'badEmail';
  return 'failed';
}

export async function pendingCode(): Promise<PendingCode | null> {
  return parsePending(await getSetting(PENDING_KEY), Date.now());
}

export async function clearPendingCode(): Promise<void> {
  await setSetting(PENDING_KEY, '');
}

export type CodeResult = { ok: true } | { ok: false; problem: CodeProblem };

/** Emails a 6-digit code. A new address gets an account when the code is used, not before. */
export async function sendEmailCode(rawEmail: string): Promise<CodeResult> {
  if (!isEmail(rawEmail)) return { ok: false, problem: 'badEmail' };
  if (!online()) return { ok: false, problem: 'offline' };
  const client = await getSupabase().catch(() => null);
  if (!client) return { ok: false, problem: 'off' };
  const email = normalizeEmail(rawEmail);
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) return { ok: false, problem: codeProblem(error) };
  await setSetting(PENDING_KEY, JSON.stringify({ email, sentAt: Date.now() } satisfies PendingCode));
  return { ok: true };
}

/** Checks the code. On success the phone is signed in and every screen hears about it. */
export async function verifyEmailCode(email: string, rawCode: string): Promise<CodeResult> {
  const token = cleanCode(rawCode);
  if (token.length !== 6) return { ok: false, problem: 'badCode' };
  if (!online()) return { ok: false, problem: 'offline' };
  const client = await getSupabase().catch(() => null);
  if (!client) return { ok: false, problem: 'off' };
  const { data, error } = await client.auth.verifyOtp({ email: normalizeEmail(email), token, type: 'email' });
  const account = accountFromUser(data?.user ?? data?.session?.user);
  if (error || !account) return { ok: false, problem: codeProblem(error) };
  await clearPendingCode();
  await save(account);
  announce(account);
  return { ok: true };
}
