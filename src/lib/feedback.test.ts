import { describe, expect, it } from 'vitest';
import { APP_BUILD, deviceSummary, fitWithin, messageOk, screenSummary, shotPath } from './feedback';

describe('feedback message', () => {
  it('needs a few characters, not just spaces', () => {
    expect(messageOk('')).toBe(false);
    expect(messageOk('   a  ')).toBe(false);
    expect(messageOk('Ang bagal')).toBe(true);
  });
  it('stops at 2,000 characters', () => {
    expect(messageOk('x'.repeat(2000))).toBe(true);
    expect(messageOk('x'.repeat(2001))).toBe(false);
  });
});

describe('screenshot size', () => {
  it('shrinks a tall phone screenshot to 1600 on the long side', () => {
    expect(fitWithin(1080, 2400, 1600)).toEqual({ w: 720, h: 1600 });
  });
  it('shrinks a landscape one too', () => {
    expect(fitWithin(2400, 1080, 1600)).toEqual({ w: 1600, h: 720 });
  });
  it('never enlarges a small one', () => {
    expect(fitWithin(720, 1600, 1600)).toEqual({ w: 720, h: 1600 });
    expect(fitWithin(360, 800, 1600)).toEqual({ w: 360, h: 800 });
  });
});

describe('what the phone sends', () => {
  it('keeps the phone model and Chrome version from the user agent', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; 2312DRAABG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36';
    expect(deviceSummary(ua)).toBe('Linux; Android 14; 2312DRAABG · Chrome/131.0.6778.81');
  });
  it('keeps an iPhone readable', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    expect(deviceSummary(ua)).toBe('iPhone; CPU iPhone OS 18_1 like Mac OS X · Version/18.1');
  });
  it('never goes over 300 characters', () => {
    expect(deviceSummary('x'.repeat(500)).length).toBe(300);
  });
  it('writes the screen size the way the database expects', () => {
    expect(screenSummary(360, 800, 2)).toBe('360x800 @2');
    expect(screenSummary(393, 873, 2.75)).toBe('393x873 @2.75');
  });
  it('has a build stamp', () => {
    expect(APP_BUILD).toMatch(/^\S+ \d{4}-\d{2}-\d{2}$|^local$/);
  });
});

describe('screenshot path', () => {
  const u = '11111111-1111-4111-8111-111111111111';
  const id = 'b1b2c3d4-0000-4000-8000-000000000001';
  it('matches the shape migration 024 allows', () => {
    const shape = new RegExp(`^${u}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(webp|jpg)$`);
    expect(shotPath(u, id, 'image/webp')).toMatch(shape);
    expect(shotPath(u, id, 'image/jpeg')).toBe(`${u}/${id}.jpg`);
  });
});
