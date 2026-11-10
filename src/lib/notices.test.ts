import { describe, expect, it } from 'vitest';
import { visibleNotices, type Notice } from './notices';

const n = (id: number, kind: Notice['kind']): Notice => ({ id, kind, title_en: `t${id}`, body_en: 'b', title_tl: null, body_tl: null });

describe('visibleNotices', () => {
  it('puts incidents first, newest first within each kind', () => {
    expect(visibleNotices([n(1, 'info'), n(2, 'incident'), n(3, 'info'), n(4, 'incident')], []).map((x) => x.id)).toEqual([4, 2, 3, 1]);
  });
  it('hides a dismissed info notice', () => {
    expect(visibleNotices([n(1, 'info'), n(2, 'info')], [2]).map((x) => x.id)).toEqual([1]);
  });
  it('keeps showing a dismissed incident notice', () => {
    expect(visibleNotices([n(5, 'incident')], [5]).map((x) => x.id)).toEqual([5]);
  });
});
