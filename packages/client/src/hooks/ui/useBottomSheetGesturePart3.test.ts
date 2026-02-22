import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type SnapPoint,
  setupResizeListener,
  useBottomSheetGesture
} from './useBottomSheetGesture';

type GestureCallback = (detail: { deltaY: number; velocityY: number }) => void;

interface MockGestureCallbacks {
  onStart: GestureCallback;
  onMove: GestureCallback;
  onEnd: GestureCallback;
}

let mockGestureCallbacks: MockGestureCallbacks | null = null;

vi.mock('@ionic/core', () => ({
  createGesture: vi.fn((options: MockGestureCallbacks) => {
    mockGestureCallbacks = {
      onStart: options.onStart,
      onMove: options.onMove,
      onEnd: options.onEnd
    };
    return {
      enable: vi.fn(),
      destroy: vi.fn()
    };
  })
}));

const defaultSnapPoints: SnapPoint[] = [
  { name: 'collapsed', height: 200 },
  { name: 'half', height: 400 },
  { name: 'expanded', height: 800 }
];describe('useBottomSheetGesture', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockGestureCallbacks = null;

    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 1000
    });
  });

  describe('Ionic gesture handlers', () => {
    function createMockHandle() {
      const handle = document.createElement('div');
      document.body.appendChild(handle);
      return handle;
    }

    it('snaps to next point up on upward gesture velocity', async () => {
      vi.useFakeTimers();
      const handle = createMockHandle();

      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85
        })
      );

      act(() => {
        result.current.handleRef(handle);
      });

      expect(result.current.height).toBe(200);

      await act(async () => {
        mockGestureCallbacks?.onStart({ deltaY: 0, velocityY: 0 });
        mockGestureCallbacks?.onMove({ deltaY: -50, velocityY: 0 });
        mockGestureCallbacks?.onEnd({ deltaY: -50, velocityY: -0.8 }); // Upward velocity
        vi.advanceTimersByTime(350);
      });

      // Should snap to half (400) - the next snap point up
      expect(result.current.height).toBe(400);
      vi.useRealTimers();
      handle.remove();
    });

    it('dismisses based on deltaY threshold', () => {
      const handle = createMockHandle();
      const onDismiss = vi.fn();

      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85,
          onDismiss,
          dismissThreshold: 50
        })
      );

      act(() => {
        result.current.handleRef(handle);
      });

      // Trigger dismiss based on deltaY (not velocity)
      act(() => {
        mockGestureCallbacks?.onStart({ deltaY: 0, velocityY: 0 });
        mockGestureCallbacks?.onMove({ deltaY: 60, velocityY: 0 });
        mockGestureCallbacks?.onEnd({ deltaY: 60, velocityY: 0.1 }); // Low velocity but high deltaY
      });

      expect(onDismiss).toHaveBeenCalled();
      handle.remove();
    });

    it('falls back when no valid snap points exist', async () => {
      vi.useFakeTimers();
      const handle = createMockHandle();

      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: [{ name: 'too-tall', height: 1000 }],
          initialSnapPoint: 'too-tall',
          minHeight: 100,
          maxHeightPercent: 0.1
        })
      );

      act(() => {
        result.current.handleRef(handle);
      });

      await act(async () => {
        mockGestureCallbacks?.onStart({ deltaY: 0, velocityY: 0 });
        mockGestureCallbacks?.onMove({ deltaY: 20, velocityY: 0 });
        mockGestureCallbacks?.onEnd({ deltaY: 20, velocityY: 0.1 });
        vi.advanceTimersByTime(350);
      });

      expect(result.current.height).toBe(100);
      vi.useRealTimers();
      handle.remove();
    });

    it('handles velocity with no available snap points', async () => {
      vi.useFakeTimers();
      const handle = createMockHandle();

      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: [{ name: 'too-tall', height: 1000 }],
          initialSnapPoint: 'too-tall',
          minHeight: 100,
          maxHeightPercent: 0.1
        })
      );

      act(() => {
        result.current.handleRef(handle);
      });

      await act(async () => {
        mockGestureCallbacks?.onStart({ deltaY: 0, velocityY: 0 });
        mockGestureCallbacks?.onMove({ deltaY: 20, velocityY: 0 });
        mockGestureCallbacks?.onEnd({ deltaY: 20, velocityY: 0.9 });
        vi.advanceTimersByTime(350);
      });

      expect(result.current.height).toBe(100);
      vi.useRealTimers();
      handle.remove();
    });
  });
});
