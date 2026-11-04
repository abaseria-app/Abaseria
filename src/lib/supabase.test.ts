import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from './supabase';

const URL = 'https://abcdefghijklmnop.supabase.co';
const KEY = 'sb_publishable_abc123';

describe('resolveConfig', () => {
  it('is off with no keys, so the app stays phone-only', () => {
    expect(resolveConfig({ MODE: 'development' })).toBeNull();
    expect(resolveConfig({ MODE: 'production', VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', VITE_SUPABASE_ENV: 'prod' })).toBeNull();
  });

  it('connects the dev server to a dev database', () => {
    expect(resolveConfig({ MODE: 'development', VITE_SUPABASE_URL: URL + '/', VITE_SUPABASE_PUBLISHABLE_KEY: KEY, VITE_SUPABASE_ENV: 'dev' }))
      .toEqual({ url: URL, key: KEY, target: 'dev' });
  });

  it('connects a production build to a prod database', () => {
    expect(resolveConfig({ MODE: 'production', VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: KEY, VITE_SUPABASE_ENV: 'prod' })?.target).toBe('prod');
  });

  it('refuses a database labeled for the other kind of build', () => {
    expect(resolveConfig({ MODE: 'development', VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: KEY, VITE_SUPABASE_ENV: 'prod' })).toBeNull();
    expect(resolveConfig({ MODE: 'production', VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: KEY, VITE_SUPABASE_ENV: 'dev' })).toBeNull();
    expect(resolveConfig({ MODE: 'production', VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: KEY })).toBeNull();
  });

  it('refuses secret keys', () => {
    expect(resolveConfig({ MODE: 'development', VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_xyz', VITE_SUPABASE_ENV: 'dev' })).toBeNull();
    const payload = btoa(JSON.stringify({ role: 'service_role' })).replace(/=+$/, '');
    expect(resolveConfig({ MODE: 'development', VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: `x.${payload}.y`, VITE_SUPABASE_ENV: 'dev' })).toBeNull();
    const anon = btoa(JSON.stringify({ role: 'anon' })).replace(/=+$/, '');
    expect(resolveConfig({ MODE: 'development', VITE_SUPABASE_URL: URL, VITE_SUPABASE_PUBLISHABLE_KEY: `x.${anon}.y`, VITE_SUPABASE_ENV: 'dev' })).not.toBeNull();
  });

  it('refuses a URL that is not a Supabase project', () => {
    expect(resolveConfig({ MODE: 'development', VITE_SUPABASE_URL: 'https://example.com', VITE_SUPABASE_PUBLISHABLE_KEY: KEY, VITE_SUPABASE_ENV: 'dev' })).toBeNull();
    expect(resolveConfig({ MODE: 'development', VITE_SUPABASE_URL: 'http://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: KEY, VITE_SUPABASE_ENV: 'dev' })).toBeNull();
  });
});

describe('checkConnection', () => {
  it('reports an error instead of crashing when the database is unreachable', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnop.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubEnv('VITE_SUPABASE_ENV', 'dev');
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    const { checkConnection } = await import('./supabase');
    try {
      expect((await checkConnection()).state).toBe('error');
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('is off when no database is set up', async () => {
    vi.resetModules();
    const { checkConnection } = await import('./supabase');
    expect(await checkConnection()).toEqual({ state: 'off' });
  });
});
