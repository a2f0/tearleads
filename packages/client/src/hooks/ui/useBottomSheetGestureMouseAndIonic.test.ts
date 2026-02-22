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
];

describe('useBottomSheetGesture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGestureCallbacks = null;

    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 1000
    });
  });

  describe('mouse event handlers', () => {
    function createMockHandle() {
      const handle = document.createElement('div');
      document.body.appendChild(handle);
      return handle;
    }

    function dispatchMouseEvent(
      element: Element | Document,
      type: string,
      clientY: number
    ) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY,
        button: 0,
        buttons: type === 'mouseup' ? 0 : 1
      });
      element.dispatchEvent(event);
    }

    it('handles mouse drag to increase height', async () => {
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

      // Simulate mouse drag
      act(() => {
        dispatchMouseEvent(handle, 'mousedown', 500);
        dispatchMouseEvent(document, 'mousemove', 400); // Drag up 100px
      });

      // Height should have changed during drag
      expect(result.current.height).toBe(300);

      // End the drag
      act(() => {
        dispatchMouseEvent(document, 'mouseup', 400);
      });

      handle.remove();
    });

    it('dismisses on fast downward mouse drag', () => {
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

      // Simulate fast downward drag exceeding dismiss threshold
      act(() => {
        dispatchMouseEvent(handle, 'mousedown', 500);
        dispatchMouseEvent(document, 'mousemove', 600);
        dispatchMouseEvent(document, 'mouseup', 600);
      });

      expect(onDismiss).toHaveBeenCalled();
      handle.remove();
    });

    it('snaps to nearest point on slow mouse release', async () => {
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

      // Simulate slow drag (small movement)
      act(() => {
        dispatchMouseEvent(handle, 'mousedown', 500);
        dispatchMouseEvent(document, 'mousemove', 480);
        dispatchMouseEvent(document, 'mouseup', 480);
        vi.advanceTimersByTime(350);
      });

      // Should snap back to collapsed (200)
      expect(result.current.height).toBe(200);
      vi.useRealTimers();
      handle.remove();
    });

    it('snaps to nearest when velocity has no lower snap point', async () => {
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

      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      act(() => {
        dispatchMouseEvent(handle, 'mousedown', 500);
      });

      vi.setSystemTime(new Date('2024-01-01T00:00:00.010Z'));
      act(() => {
        dispatchMouseEvent(document, 'mousemove', 510);
      });

      vi.setSystemTime(new Date('2024-01-01T00:00:00.011Z'));
      act(() => {
        dispatchMouseEvent(document, 'mouseup', 515);
        vi.advanceTimersByTime(350);
      });

      expect(result.current.height).toBe(200);
      vi.useRealTimers();
      handle.remove();
    });

    it('respects min and max height constraints during mouse drag', () => {
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

      // Try to drag below min height
      act(() => {
        dispatchMouseEvent(handle, 'mousedown', 500);
        dispatchMouseEvent(document, 'mousemove', 800); // Try to shrink a lot
      });

      // Height should be clamped to minHeight
      expect(result.current.height).toBeGreaterThanOrEqual(100);

      // Clean up
      act(() => {
        dispatchMouseEvent(document, 'mouseup', 800);
      });

      handle.remove();
    });

    it('ignores mouse events when not dragging', () => {
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

      // Dispatch mousemove and mouseup without mousedown
      act(() => {
        dispatchMouseEvent(document, 'mousemove', 400);
        dispatchMouseEvent(document, 'mouseup', 400);
      });

      // Height should remain unchanged
      expect(result.current.height).toBe(200);
      handle.remove();
    });

    it('cleans up event listeners on unmount', () => {
      const handle = createMockHandle();

      const { result, unmount } = renderHook(() =>
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

      // Start a drag
      act(() => {
        dispatchMouseEvent(handle, 'mousedown', 500);
      });

      // Unmount while dragging
      unmount();

      // Dispatch events after unmount - should not throw
      dispatchMouseEvent(document, 'mousemove', 400);
      dispatchMouseEvent(document, 'mouseup', 400);

      handle.remove();
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

  describe('window resize', () => {
    it('updates window height on resize', () => {
      const { result } = renderHook(() =>
        useBottomSheetGesture({
          snapPoints: defaultSnapPoints,
          initialSnapPoint: 'collapsed',
          minHeight: 100,
          maxHeightPercent: 0.85
        })
      );

      expect(result.current.height).toBe(200);

      // Simulate window resize
      act(() => {
        Object.defineProperty(window, 'innerHeight', {
          writable: true,
          configurable: true,
          value: 500
        });
        window.dispatchEvent(new Event('resize'));
      });

      // Height should still be correct
      expect(result.current.height).toBe(200);
    });

    it('returns a no-op cleanup when window is unavailable', () => {
      const originalWindow = globalThis.window;
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        configurable: true
      });

      const cleanup = setupResizeListener(() => {});
      expect(typeof cleanup).toBe('function');
      cleanup();

      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true
      });
    });
  });
});
