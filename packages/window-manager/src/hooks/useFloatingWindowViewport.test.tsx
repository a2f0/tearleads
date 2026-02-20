import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFloatingWindow } from './useFloatingWindow.js';

describe('useFloatingWindow viewport constraints', () => {
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

  it('constrains position within viewport on drag', () => {
    const { result } = renderHook(() => useFloatingWindow(defaultOptions));

    const dragHandlers = result.current.createDragHandlers();

    act(() => {
      dragHandlers.onMouseDown({
        preventDefault: vi.fn(),
        clientX: 100,
        clientY: 100
      } as unknown as React.MouseEvent);
    });

    // Try to drag way off screen to the right/bottom
    act(() => {
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 5000,
        clientY: 5000
      });
      document.dispatchEvent(moveEvent);
    });

    // Position should be constrained to viewport
    expect(result.current.x).toBeLessThanOrEqual(
      window.innerWidth - result.current.width
    );
    expect(result.current.y).toBeLessThanOrEqual(
      window.innerHeight - result.current.height
    );
  });

  it('constrains position to not go negative', () => {
    const { result } = renderHook(() => useFloatingWindow(defaultOptions));

    const dragHandlers = result.current.createDragHandlers();

    act(() => {
      dragHandlers.onMouseDown({
        preventDefault: vi.fn(),
        clientX: 100,
        clientY: 100
      } as unknown as React.MouseEvent);
    });

    // Try to drag way off screen to the left/top
    act(() => {
      const moveEvent = new MouseEvent('mousemove', {
        clientX: -5000,
        clientY: -5000
      });
      document.dispatchEvent(moveEvent);
    });

    expect(result.current.x).toBeGreaterThanOrEqual(0);
    expect(result.current.y).toBeGreaterThanOrEqual(0);
  });

  it('adjusts position on window resize', () => {
    const { result } = renderHook(() =>
      useFloatingWindow({
        ...defaultOptions,
        defaultX: 800,
        defaultY: 600
      })
    );

    // Initial position is at 800, 600
    expect(result.current.x).toBe(800);
    expect(result.current.y).toBe(600);

    // Simulate window resize to smaller size
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 500
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 400
      });
      window.dispatchEvent(new Event('resize'));
    });

    // Position should be constrained to new viewport
    expect(result.current.x).toBeLessThanOrEqual(500 - result.current.width);
    expect(result.current.y).toBeLessThanOrEqual(400 - result.current.height);
  });

  it('uses actual rendered dimensions from elementRef when dragging', () => {
    // Simulate a scenario where CSS constrains the window smaller than state width
    // (e.g., maxWidth: 80vw when viewport shrinks due to DevTools)
    const mockElement = {
      getBoundingClientRect: () => ({
        width: 300, // CSS-constrained to 300px
        height: 250 // CSS-constrained to 250px
      })
    } as HTMLElement;

    const elementRef = { current: mockElement };

    const { result } = renderHook(() =>
      useFloatingWindow({
        ...defaultOptions,
        defaultX: 0,
        defaultY: 0,
        defaultWidth: 500, // State width is 500px
        defaultHeight: 400, // State height is 400px
        elementRef
      })
    );

    // Viewport is 1024x768, state width is 500, but actual rendered width is 300
    // Without elementRef fix: maxX would be 1024 - 500 = 524
    // With elementRef fix: maxX should be 1024 - 300 = 724
    const dragHandlers = result.current.createDragHandlers();

    act(() => {
      dragHandlers.onMouseDown({
        preventDefault: vi.fn(),
        clientX: 0,
        clientY: 0
      } as unknown as React.MouseEvent);
    });

    // Try to drag to X=700 (would be blocked without fix since 700 > 524)
    act(() => {
      const moveEvent = new MouseEvent('mousemove', {
        clientX: 700,
        clientY: 0
      });
      document.dispatchEvent(moveEvent);
    });

    // With the fix, position should reach 700 since actual width is 300 (700 + 300 < 1024)
    expect(result.current.x).toBe(700);
  });

  it('uses actual rendered dimensions from elementRef on window resize', () => {
    const mockElement = {
      getBoundingClientRect: () => ({
        width: 300,
        height: 250
      })
    } as HTMLElement;

    const elementRef = { current: mockElement };

    const { result } = renderHook(() =>
      useFloatingWindow({
        ...defaultOptions,
        defaultX: 600,
        defaultY: 400,
        defaultWidth: 500,
        defaultHeight: 400,
        elementRef
      })
    );

    // Simulate viewport shrinking (like DevTools opening)
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 800
      });
      window.dispatchEvent(new Event('resize'));
    });

    // Without fix: maxX = 800 - 500 = 300, so X would clamp to 300
    // With fix: maxX = 800 - 300 = 500, so X should clamp to 500
    expect(result.current.x).toBe(500);
  });
});
