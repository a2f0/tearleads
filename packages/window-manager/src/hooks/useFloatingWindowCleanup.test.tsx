import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFloatingWindow } from './useFloatingWindow.js';

function createTouchEvent(
  type: string,
  touches: Array<{ clientX: number; clientY: number }> = []
): Event {
  const event = new Event(type);
  Object.defineProperty(event, 'touches', {
    configurable: true,
    value: touches
  });
  Object.defineProperty(event, 'changedTouches', {
    configurable: true,
    value: touches
  });
  Object.defineProperty(event, 'targetTouches', {
    configurable: true,
    value: touches
  });
  return event;
}

describe('useFloatingWindow cleanup and edge cases', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 768
    });
  });

  const defaultOptions = {
    defaultWidth: 400,
    defaultHeight: 300,
    defaultX: 100,
    defaultY: 100,
    minWidth: 200,
    minHeight: 150,
    maxWidthPercent: 0.6,
    maxHeightPercent: 0.7
  };

  describe('cleanup', () => {
    it('removes event listeners on mouseup', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const dragHandlers = result.current.createDragHandlers();

      act(() => {
        dragHandlers.onMouseDown({
          preventDefault: vi.fn(),
          clientX: 150,
          clientY: 150
        } as unknown as React.MouseEvent);
      });

      act(() => {
        const upEvent = new MouseEvent('mouseup');
        document.dispatchEvent(upEvent);
      });

      const initialX = result.current.x;

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 500,
          clientY: 500
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.x).toBe(initialX);
    });

    it('removes event listeners on touchend', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const dragHandlers = result.current.createDragHandlers();

      act(() => {
        dragHandlers.onTouchStart({
          preventDefault: vi.fn(),
          touches: [{ clientX: 150, clientY: 150 }]
        } as unknown as React.TouchEvent);
      });

      act(() => {
        const endEvent = createTouchEvent('touchend');
        document.dispatchEvent(endEvent);
      });

      const initialX = result.current.x;

      act(() => {
        const moveEvent = createTouchEvent('touchmove', [
          { clientX: 500, clientY: 500 }
        ]);
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.x).toBe(initialX);
    });

    it('cleans up on unmount', () => {
      const { result, unmount } = renderHook(() =>
        useFloatingWindow(defaultOptions)
      );

      const dragHandlers = result.current.createDragHandlers();

      act(() => {
        dragHandlers.onMouseDown({
          preventDefault: vi.fn(),
          clientX: 150,
          clientY: 150
        } as unknown as React.MouseEvent);
      });

      unmount();

      expect(document.body.style.cursor).toBe('');
      expect(document.body.style.userSelect).toBe('');
    });
  });

  describe('edge cases', () => {
    it('ignores move events when not dragging', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 500,
          clientY: 500
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.x).toBe(100);
      expect(result.current.y).toBe(100);
    });

    it('ignores end events when not dragging', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      act(() => {
        const upEvent = new MouseEvent('mouseup');
        document.dispatchEvent(upEvent);
      });

      expect(result.current.x).toBe(100);
      expect(result.current.y).toBe(100);
    });

    it('handles touchMove with no touches', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const dragHandlers = result.current.createDragHandlers();

      act(() => {
        dragHandlers.onTouchStart({
          preventDefault: vi.fn(),
          touches: [{ clientX: 150, clientY: 150 }]
        } as unknown as React.TouchEvent);
      });

      const initialX = result.current.x;

      act(() => {
        const moveEvent = createTouchEvent('touchmove');
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.x).toBe(initialX);
    });
  });
});
