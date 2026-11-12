import { describe, expect, it } from 'vitest';
import { CODE_MINUTES, cleanCode, codeProblem, isEmail, normalizeEmail, parsePending } from './auth';

describe('email address', () => {
  it('accepts ordinary addresses, trimmed', () => {
    expect(isEmail('juan@gmail.com')).toBe(true);
    expect(isEmail('  maria.santos@yahoo.com.ph ')).toBe(true);
  });
  it('refuses obvious typos', () => {
    for (const bad of ['', 'juan', 'juan@', 'juan@gmail', 'juan @gmail.com', '@gmail.com']) expect(isEmail(bad)).toBe(false);
  });
  it('one address, one account, whatever the capitals', () => {
    expect(normalizeEmail(' Juan@Gmail.COM ')).toBe('juan@gmail.com');
  });
});

describe('code box', () => {
  it('keeps only the 6 digits from a paste', () => {
    expect(cleanCode(' 123 456\n')).toBe('123456');
    expect(cleanCode('Your code: 987654')).toBe('987654');
    expect(cleanCode('12345678')).toBe('123456');
  });
});

describe('waiting code', () => {
  const sentAt = 1_000_000;
  const raw = JSON.stringify({ email: 'juan@gmail.com', sentAt });
  it('comes back within the code\'s lifetime', () => {
    expect(parsePending(raw, sentAt + 60_000)).toEqual({ email: 'juan@gmail.com', sentAt });
  });
  it('is dropped once the code has expired', () => {
    expect(parsePending(raw, sentAt + CODE_MINUTES * 60_000)).toBeNull();
  });
  it('ignores empty or broken records', () => {
    expect(parsePending('', sentAt)).toBeNull();
    expect(parsePending('{oops', sentAt)).toBeNull();
    expect(parsePending(JSON.stringify({ email: 1 }), sentAt)).toBeNull();
  });
});

describe('codeProblem', () => {
  it('reads Supabase\'s messages', () => {
    expect(codeProblem({ code: 'otp_expired', message: 'Token has expired or is invalid' })).toBe('badCode');
    expect(codeProblem({ message: 'Token has expired or is invalid' })).toBe('badCode');
    expect(codeProblem({ code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' })).toBe('wait');
    expect(codeProblem({ status: 429, message: 'Email rate limit exceeded' })).toBe('tooMany');
    expect(codeProblem({ code: 'email_address_invalid', message: 'Email address "x" is invalid' })).toBe('badEmail');
    expect(codeProblem({ message: 'Error sending magic link email' })).toBe('failed');
    expect(codeProblem(null)).toBe('failed');
  });
});
