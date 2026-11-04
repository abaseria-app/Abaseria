import { describe, expect, it } from 'vitest';
import { squareCrop } from './thumb';

describe('squareCrop', () => {
  it('takes a centered square from a landscape frame', () => {
    expect(squareCrop(1920, 1080)).toEqual({ x: 528, y: 108, w: 864, h: 864 });
  });
  it('takes a centered square from a portrait frame', () => {
    expect(squareCrop(1080, 1920)).toEqual({ x: 108, y: 528, w: 864, h: 864 });
  });
  it('centers on the focus box', () => {
    const c = squareCrop(1920, 1080, { x: 1000, y: 300, w: 400, h: 200 }, 0.5);
    expect(c).toEqual({ x: 930, y: 130, w: 540, h: 540 });
  });
  it('stays inside the frame when the focus is near an edge', () => {
    const c = squareCrop(1920, 1080, { x: 0, y: 0, w: 100, h: 100 });
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    const d = squareCrop(1920, 1080, { x: 1850, y: 1000, w: 70, h: 80 });
    expect(d.x + d.w).toBe(1920);
    expect(d.y + d.h).toBe(1080);
  });
});
