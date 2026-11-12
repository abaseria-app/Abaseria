import { describe, expect, it } from 'vitest';
import { isStaffRole, parseSaved, roleLabel } from './staff';

describe('staff roles', () => {
  it('knows the three roles and nothing else', () => {
    expect(['admin', 'product_manager', 'data_entry'].every(isStaffRole)).toBe(true);
    expect(isStaffRole('owner')).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });

  it('shows Data Entry as Collector', () => {
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('product_manager')).toBe('Product Manager');
    expect(roleLabel('data_entry')).toBe('Collector');
  });

  it('uses the saved role only for the account it was saved for', () => {
    const raw = JSON.stringify({ id: 'brad', role: 'admin' });
    expect(parseSaved(raw, 'brad')).toBe('admin');
    expect(parseSaved(raw, 'jovie')).toBeNull();
  });

  it('ignores an empty, broken or unknown saved value', () => {
    expect(parseSaved('', 'brad')).toBeNull();
    expect(parseSaved(null, 'brad')).toBeNull();
    expect(parseSaved('{not json', 'brad')).toBeNull();
    expect(parseSaved(JSON.stringify({ id: 'brad', role: 'owner' }), 'brad')).toBeNull();
  });
});
