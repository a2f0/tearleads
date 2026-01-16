import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFloatingWindow } from './useFloatingWindow';

describe('useFloatingWindow', () => {
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

  it('returns initial dimensions and position', () => {
    const { result } = renderHook(() => useFloatingWindow(defaultOptions));

    expect(result.current.width).toBe(400);
    expect(result.current.height).toBe(300);
    expect(result.current.x).toBe(100);
    expect(result.current.y).toBe(100);
  });

  it('uses 0 as default position when not specified', () => {
    const optionsWithoutPosition = {
      defaultWidth: defaultOptions.defaultWidth,
      defaultHeight: defaultOptions.defaultHeight,
      minWidth: defaultOptions.minWidth,
      minHeight: defaultOptions.minHeight,
      maxWidthPercent: defaultOptions.maxWidthPercent,
      maxHeightPercent: defaultOptions.maxHeightPercent
    };
    const { result } = renderHook(() =>
      useFloatingWindow(optionsWithoutPosition)
    );

    expect(result.current.x).toBe(0);
    expect(result.current.y).toBe(0);
  });

  describe('dragging', () => {
    it('updates position when dragged', () => {
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
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 250,
          clientY: 200
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.x).toBe(200);
      expect(result.current.y).toBe(150);
    });

    it('handles touch dragging', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const dragHandlers = result.current.createDragHandlers();

      act(() => {
        dragHandlers.onTouchStart({
          touches: [{ clientX: 150, clientY: 150 }]
        } as unknown as React.TouchEvent);
      });

      act(() => {
        const moveEvent = new TouchEvent('touchmove', {
          touches: [{ clientX: 250, clientY: 200 } as Touch]
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.x).toBe(200);
      expect(result.current.y).toBe(150);
    });

    it('ignores touchStart with no touches', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const dragHandlers = result.current.createDragHandlers();

      act(() => {
        dragHandlers.onTouchStart({
          touches: []
        } as unknown as React.TouchEvent);
      });

      expect(result.current.x).toBe(100);
      expect(result.current.y).toBe(100);
    });
  });

  describe('corner resizing', () => {
    it('resizes from bottom-right corner', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const cornerHandlers =
        result.current.createCornerHandlers('bottom-right');

      act(() => {
        cornerHandlers.onMouseDown({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 500,
          clientY: 400
        } as unknown as React.MouseEvent);
      });

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 600,
          clientY: 500
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.width).toBe(500);
      expect(result.current.height).toBe(400);
      expect(result.current.x).toBe(100);
      expect(result.current.y).toBe(100);
    });

    it('resizes from top-left corner and adjusts position', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const cornerHandlers = result.current.createCornerHandlers('top-left');

      act(() => {
        cornerHandlers.onMouseDown({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 100,
          clientY: 100
        } as unknown as React.MouseEvent);
      });

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 50,
          clientY: 50
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.width).toBe(450);
      expect(result.current.height).toBe(350);
      expect(result.current.x).toBe(50);
      expect(result.current.y).toBe(50);
    });

    it('resizes from top-right corner', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const cornerHandlers = result.current.createCornerHandlers('top-right');

      act(() => {
        cornerHandlers.onMouseDown({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 500,
          clientY: 100
        } as unknown as React.MouseEvent);
      });

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 600,
          clientY: 50
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.width).toBe(500);
      expect(result.current.height).toBe(350);
      expect(result.current.x).toBe(100);
      expect(result.current.y).toBe(50);
    });

    it('resizes from bottom-left corner', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const cornerHandlers = result.current.createCornerHandlers('bottom-left');

      act(() => {
        cornerHandlers.onMouseDown({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 100,
          clientY: 400
        } as unknown as React.MouseEvent);
      });

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 50,
          clientY: 500
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.width).toBe(450);
      expect(result.current.height).toBe(400);
      expect(result.current.x).toBe(50);
      expect(result.current.y).toBe(100);
    });

    it('handles touch resizing', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const cornerHandlers =
        result.current.createCornerHandlers('bottom-right');

      act(() => {
        cornerHandlers.onTouchStart({
          stopPropagation: vi.fn(),
          touches: [{ clientX: 500, clientY: 400 }]
        } as unknown as React.TouchEvent);
      });

      act(() => {
        const moveEvent = new TouchEvent('touchmove', {
          touches: [{ clientX: 600, clientY: 500 } as Touch]
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.width).toBe(500);
      expect(result.current.height).toBe(400);
    });

    it('ignores corner touchStart with no touches', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const cornerHandlers =
        result.current.createCornerHandlers('bottom-right');

      act(() => {
        cornerHandlers.onTouchStart({
          stopPropagation: vi.fn(),
          touches: []
        } as unknown as React.TouchEvent);
      });

      expect(result.current.width).toBe(400);
      expect(result.current.height).toBe(300);
    });
  });

  describe('constraints', () => {
    it('respects minimum width', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const cornerHandlers =
        result.current.createCornerHandlers('bottom-right');

      act(() => {
        cornerHandlers.onMouseDown({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 500,
          clientY: 400
        } as unknown as React.MouseEvent);
      });

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 0,
          clientY: 400
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.width).toBe(200);
    });

    it('respects minimum height', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const cornerHandlers =
        result.current.createCornerHandlers('bottom-right');

      act(() => {
        cornerHandlers.onMouseDown({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 500,
          clientY: 400
        } as unknown as React.MouseEvent);
      });

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 500,
          clientY: 0
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.height).toBe(150);
    });

    it('respects maximum width', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const cornerHandlers =
        result.current.createCornerHandlers('bottom-right');

      act(() => {
        cornerHandlers.onMouseDown({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 500,
          clientY: 400
        } as unknown as React.MouseEvent);
      });

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 2000,
          clientY: 400
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.width).toBeLessThanOrEqual(1024 * 0.6);
    });

    it('respects maximum height', () => {
      const { result } = renderHook(() => useFloatingWindow(defaultOptions));

      const cornerHandlers =
        result.current.createCornerHandlers('bottom-right');

      act(() => {
        cornerHandlers.onMouseDown({
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 500,
          clientY: 400
        } as unknown as React.MouseEvent);
      });

      act(() => {
        const moveEvent = new MouseEvent('mousemove', {
          clientX: 500,
          clientY: 2000
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.height).toBeLessThanOrEqual(768 * 0.7);
    });
  });

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
          touches: [{ clientX: 150, clientY: 150 }]
        } as unknown as React.TouchEvent);
      });

      act(() => {
        const endEvent = new TouchEvent('touchend');
        document.dispatchEvent(endEvent);
      });

      const initialX = result.current.x;

      act(() => {
        const moveEvent = new TouchEvent('touchmove', {
          touches: [{ clientX: 500, clientY: 500 } as Touch]
        });
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
          touches: [{ clientX: 150, clientY: 150 }]
        } as unknown as React.TouchEvent);
      });

      const initialX = result.current.x;

      act(() => {
        const moveEvent = new TouchEvent('touchmove', {
          touches: []
        });
        document.dispatchEvent(moveEvent);
      });

      expect(result.current.x).toBe(initialX);
    });
  });
});
