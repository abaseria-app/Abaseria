import { describe, expect, it } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { accountFromUser, cleanUrl, isMissingEmail, isProvider, readReturn, redirectUrl, shouldStartFresh } from './auth';

const user = (over: Partial<User>): User =>
  ({ id: 'u1', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '', ...over }) as User;

describe('accountFromUser', () => {
  it('takes the Google name and email', () => {
    expect(accountFromUser(user({ email: 'jo@gmail.com', user_metadata: { full_name: ' Jovie K ' } }))).toEqual({
      id: 'u1', name: 'Jovie K', email: 'jo@gmail.com',
    });
  });
  it('falls back to "name", then to no name', () => {
    expect(accountFromUser(user({ user_metadata: { name: 'Brad' } }))?.name).toBe('Brad');
    expect(accountFromUser(user({ email: 'x@y.ph' }))).toEqual({ id: 'u1', name: null, email: 'x@y.ph' });
  });
  it('treats an anonymous phone as not signed in', () => {
    expect(accountFromUser(user({ is_anonymous: true }))).toBeNull();
    expect(accountFromUser(null)).toBeNull();
  });
});

describe('redirectUrl', () => {
  it('sends each app back to itself', () => {
    expect(redirectUrl('https://abaseria-app.github.io', '/Abaseria/')).toBe('https://abaseria-app.github.io/Abaseria/');
    expect(redirectUrl('https://abaseria-app.github.io', '/Abaseria/dev/')).toBe('https://abaseria-app.github.io/Abaseria/dev/');
    expect(redirectUrl('http://localhost:5173', '/')).toBe('http://localhost:5173/');
  });
});

describe('readReturn and cleanUrl', () => {
  const base = 'https://abaseria-app.github.io/Abaseria/dev/';
  it('spots a sign-in code coming back from Google', () => {
    expect(readReturn(`${base}?code=abc123`)).toEqual({ finishing: true, error: null, code: null });
    expect(cleanUrl(`${base}?code=abc123`)).toBe(base);
  });
  it('reads an error, in the query or the hash', () => {
    const q = `${base}?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user`;
    expect(readReturn(q)).toEqual({ finishing: false, error: 'Identity is already linked to another user', code: 'identity_already_exists' });
    expect(readReturn(`${base}#error=access_denied&error_description=User+cancelled`).error).toBe('User cancelled');
    expect(cleanUrl(q)).toBe(base);
    expect(cleanUrl(`${base}#error=access_denied`)).toBe(base);
  });
  it('drops the "#_=_" Facebook adds to every return', () => {
    expect(readReturn(`${base}?code=abc123#_=_`)).toEqual({ finishing: true, error: null, code: null });
    expect(cleanUrl(`${base}?code=abc123#_=_`)).toBe(base);
  });
  it('leaves a normal address alone', () => {
    expect(readReturn(base)).toEqual({ finishing: false, error: null, code: null });
    expect(cleanUrl(`${base}?x=1`)).toBe(`${base}?x=1`);
  });
});

describe('shouldStartFresh', () => {
  it('falls back to a plain Google sign-in when linking is off in Supabase', () => {
    expect(shouldStartFresh({ code: 'manual_linking_disabled', message: 'Manual linking is disabled' })).toBe(true);
    expect(shouldStartFresh({ message: 'Manual linking is disabled' })).toBe(true);
  });
  it('shows other errors instead', () => {
    expect(shouldStartFresh({ code: 'provider_disabled', message: 'Unsupported provider' })).toBe(false);
    expect(shouldStartFresh(null)).toBe(false);
  });
});

describe('isMissingEmail', () => {
  it('spots a Facebook account with no email (Supabase refuses it)', () => {
    const back = readReturn(
      'https://abaseria-app.github.io/Abaseria/dev/?error=server_error&error_code=unexpected_failure&error_description=Error+getting+user+email+from+external+provider#_=_',
    );
    expect(isMissingEmail(back.error)).toBe(true);
  });
  it('ignores other errors', () => {
    expect(isMissingEmail('User cancelled')).toBe(false);
    expect(isMissingEmail(null)).toBe(false);
  });
});

describe('isProvider', () => {
  it('accepts only the two sign-in buttons', () => {
    expect(isProvider('google')).toBe(true);
    expect(isProvider('facebook')).toBe(true);
    expect(isProvider('apple')).toBe(false);
    expect(isProvider(null)).toBe(false);
  });
});
