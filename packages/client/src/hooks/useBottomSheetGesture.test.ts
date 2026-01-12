import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SnapPoint, useBottomSheetGesture } from './useBottomSheetGesture';

vi.mock('@ionic/core', () => ({
  createGesture: vi.fn(() => ({
    enable: vi.fn(),
    destroy: vi.fn()
  }))
}));

const defaultSnapPoints: SnapPoint[] = [
  { name: 'collapsed', height: 200 },
  { name: 'half', height: 400 },
  { name: 'expanded', height: 800 }
];

describe('useBottomSheetGesture', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 1000
    });
  });

  it('initializes with the correct snap point height', () => {
    const { result } = renderHook(() =>
      useBottomSheetGesture({
        snapPoints: defaultSnapPoints,
        initialSnapPoint: 'collapsed',
        minHeight: 100,
        maxHeightPercent: 0.85
      })
    );

    expect(result.current.height).toBe(200);
    expect(result.current.currentSnapPoint).toBe('collapsed');
  });

  it('initializes with half snap point', () => {
    const { result } = renderHook(() =>
      useBottomSheetGesture({
        snapPoints: defaultSnapPoints,
        initialSnapPoint: 'half',
        minHeight: 100,
        maxHeightPercent: 0.85
      })
    );

    expect(result.current.height).toBe(400);
  });

  it('initializes with expanded snap point', () => {
    const { result } = renderHook(() =>
      useBottomSheetGesture({
        snapPoints: defaultSnapPoints,
        initialSnapPoint: 'expanded',
        minHeight: 100,
        maxHeightPercent: 0.85
      })
    );

    expect(result.current.height).toBe(800);
  });

  it('falls back to first snap point if initial not found', () => {
    const { result } = renderHook(() =>
      useBottomSheetGesture({
        snapPoints: defaultSnapPoints,
        initialSnapPoint: 'nonexistent',
        minHeight: 100,
        maxHeightPercent: 0.85
      })
    );

    expect(result.current.height).toBe(200);
  });

  it('falls back to minHeight if no snap points', () => {
    const { result } = renderHook(() =>
      useBottomSheetGesture({
        snapPoints: [],
        initialSnapPoint: 'collapsed',
        minHeight: 150,
        maxHeightPercent: 0.85
      })
    );

    expect(result.current.height).toBe(150);
  });

  it('provides refs for sheet and handle', () => {
    const { result } = renderHook(() =>
      useBottomSheetGesture({
        snapPoints: defaultSnapPoints,
        initialSnapPoint: 'collapsed',
        minHeight: 100,
        maxHeightPercent: 0.85
      })
    );

    expect(result.current.sheetRef).toBeDefined();
    expect(result.current.handleRef).toBeDefined();
    expect(result.current.sheetRef.current).toBeNull();
    expect(result.current.handleRef.current).toBeNull();
  });

  it('provides isAnimating state initially false', () => {
    const { result } = renderHook(() =>
      useBottomSheetGesture({
        snapPoints: defaultSnapPoints,
        initialSnapPoint: 'collapsed',
        minHeight: 100,
        maxHeightPercent: 0.85
      })
    );

    expect(result.current.isAnimating).toBe(false);
  });

  it('provides snapTo function', () => {
    const { result } = renderHook(() =>
      useBottomSheetGesture({
        snapPoints: defaultSnapPoints,
        initialSnapPoint: 'collapsed',
        minHeight: 100,
        maxHeightPercent: 0.85
      })
    );

    expect(typeof result.current.snapTo).toBe('function');
  });

  describe('snapTo', () => {
    it('animates to specified snap point', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85
        })
      );

      act(() => {
        result.current.snapTo('expanded');
      });

      expect(result.current.isAnimating).toBe(true);

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(result.current.height).toBe(800);
      expect(result.current.isAnimating).toBe(false);
      vi.useRealTimers();
    });

    it('animates to half snap point', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85
        })
      );

      act(() => {
        result.current.snapTo('half');
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(result.current.height).toBe(400);
      expect(result.current.currentSnapPoint).toBe('half');
      vi.useRealTimers();
    });

    it('respects max height when snapping', async () => {
      vi.useFakeTimers();
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 500
      });

      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85
        })
      );

      act(() => {
        result.current.snapTo('expanded');
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(result.current.height).toBe(425);
      vi.useRealTimers();
    });

    it('does nothing for unknown snap point', () => {
      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85
        })
      );

      const initialHeight = result.current.height;

      act(() => {
        result.current.snapTo('unknown');
      });

      expect(result.current.height).toBe(initialHeight);
      expect(result.current.isAnimating).toBe(false);
    });

    it('updates currentSnapPoint after animation', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85
        })
      );

      expect(result.current.currentSnapPoint).toBe('collapsed');

      act(() => {
        result.current.snapTo('expanded');
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(result.current.currentSnapPoint).toBe('expanded');
      vi.useRealTimers();
    });
  });

  describe('edge cases', () => {
    it('handles single snap point', () => {
      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: [{ name: 'only', height: 300 }],
          initialSnapPoint: 'only',
          minHeight: 100,
          maxHeightPercent: 0.85
        })
      );

      expect(result.current.height).toBe(300);
    });

    it('handles snap points exceeding max height', () => {
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 300
      });

      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85
        })
      );

      expect(result.current.height).toBe(200);
    });

    it('uses custom velocity threshold', () => {
      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85,
          velocityThreshold: 1.0
        })
      );

      expect(result.current.height).toBe(200);
    });

    it('uses custom dismiss threshold', () => {
      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85,
          dismissThreshold: 200
        })
      );

      expect(result.current.height).toBe(200);
    });

    it('accepts onDismiss callback', () => {
      const onDismiss = vi.fn();
      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85,
          onDismiss
        })
      );

      expect(result.current.height).toBe(200);
    });
  });
});
