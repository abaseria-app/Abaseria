import { describe, expect, it } from 'vitest';
import { fitInside } from './thumb';

describe('fitInside', () => {
  it('fits a wide image across the box, centered top to bottom', () => {
    expect(fitInside(800, 400, 168)).toEqual({ x: 0, y: 42, w: 168, h: 84 });
  });
  it('fits a tall bottle down the box, centered side to side', () => {
    expect(fitInside(300, 900, 168)).toEqual({ x: 56, y: 0, w: 56, h: 168 });
  });
  it('grows a small square image to fill the box', () => {
    expect(fitInside(100, 100, 168)).toEqual({ x: 0, y: 0, w: 168, h: 168 });
  });
});
