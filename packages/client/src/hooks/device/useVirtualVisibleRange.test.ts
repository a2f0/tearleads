import type { VirtualItem } from '@tanstack/react-virtual';
import { describe, expect, it } from 'vitest';
import { useVirtualVisibleRange } from './useVirtualVisibleRange';

describe('useVirtualVisibleRange', () => {
  it('returns null values for empty array', () => {
    const result = useVirtualVisibleRange([]);
    expect(result.firstVisible).toBeNull();
    expect(result.lastVisible).toBeNull();
  });

  it('returns correct range for single item', () => {
    const virtualItems = [{ index: 5 }] as VirtualItem[];
    const result = useVirtualVisibleRange(virtualItems);
    expect(result.firstVisible).toBe(5);
    expect(result.lastVisible).toBe(5);
  });

  it('returns correct range for multiple items', () => {
    const virtualItems = [
      { index: 10 },
      { index: 11 },
      { index: 12 },
      { index: 13 }
    ] as VirtualItem[];
    const result = useVirtualVisibleRange(virtualItems);
    expect(result.firstVisible).toBe(10);
    expect(result.lastVisible).toBe(13);
  });

  it('handles undefined index gracefully', () => {
    const virtualItems = [
      { index: undefined },
      { index: 5 }
    ] as unknown as VirtualItem[];
    const result = useVirtualVisibleRange(virtualItems);
    expect(result.firstVisible).toBeNull();
    expect(result.lastVisible).toBe(5);
  });
});
