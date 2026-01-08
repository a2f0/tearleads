import { describe, expect, it } from 'vitest';
import { CustomDot } from './CustomDot';

describe('CustomDot', () => {
  it('returns null when cx is undefined', () => {
    const result = CustomDot({ cy: 100, fill: 'blue' });
    expect(result).toBeNull();
  });

  it('returns null when cy is undefined', () => {
    const result = CustomDot({ cx: 100, fill: 'blue' });
    expect(result).toBeNull();
  });

  it('renders a circle when cx and cy are defined', () => {
    const result = CustomDot({ cx: 100, cy: 50, fill: 'blue' });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('circle');
    expect(result?.props.cx).toBe(100);
    expect(result?.props.cy).toBe(50);
    expect(result?.props.fill).toBe('blue');
    expect(result?.props.r).toBe(3); // SCATTER_DOT_RADIUS
  });
});
