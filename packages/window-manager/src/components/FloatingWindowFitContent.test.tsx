import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingWindow } from './FloatingWindow.js';

const FOOTER_HEIGHT = 56;

describe('FloatingWindow fitContent behavior', () => {
  const defaultProps = {
    id: 'test-window',
    title: 'Test Window',
    onClose: vi.fn(),
    children: <div data-testid="window-content">Content</div>,
    footerHeight: FOOTER_HEIGHT
  };

  const originalResizeObserver = global.ResizeObserver;
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollHeight'
  );
  const originalScrollWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollWidth'
  );
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight'
  );

  let resizeObserverCallback: ResizeObserverCallback | null = null;
  let resizeObserverInstance: ResizeObserver | null = null;
  let scrollHeight = 900;
  let scrollWidth = 700;

  beforeEach(() => {
    vi.clearAllMocks();
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

    scrollHeight = 900;
    scrollWidth = 700;
    resizeObserverCallback = null;

    class MockResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
        resizeObserverInstance = this;
      }

      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }

    global.ResizeObserver = MockResizeObserver;
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => scrollWidth
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 28
    });
  });

  afterEach(() => {
    if (originalScrollHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollHeight',
        originalScrollHeight
      );
    }

    if (originalScrollWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollWidth',
        originalScrollWidth
      );
    }

    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetHeight',
        originalOffsetHeight
      );
    }

    global.ResizeObserver = originalResizeObserver;
  });

  it('sizes to fit content up to the maximized bounds', async () => {
    // Mocked values: scrollWidth=700, scrollHeight=900, offsetHeight=28
    // footerHeight=56, window: 1024x768
    // maxHeight = (768 - 56) * 1 = 712
    // height = min(900 + 28, 712) = 712 (clamped)
    // width = 700 (fits within 1024)
    // x = (1024 - 700) / 2 = 162
    // y = (712 - 712) / 2 = 0
    render(
      <FloatingWindow
        {...defaultProps}
        fitContent
        maxWidthPercent={1}
        maxHeightPercent={1}
      />
    );

    const dialog = screen.getByRole('dialog');

    await waitFor(() => {
      expect(dialog).toHaveStyle({ width: '700px', height: '712px' });
    });

    expect(dialog).toHaveStyle({ left: '162px', top: '0px' });
  });

  it('recalculates height after content size changes', async () => {
    scrollHeight = 500;
    scrollWidth = 700;

    render(
      <FloatingWindow
        {...defaultProps}
        fitContent
        maxWidthPercent={1}
        maxHeightPercent={1}
      />
    );

    const dialog = screen.getByRole('dialog');

    await waitFor(() => {
      expect(dialog).toHaveStyle({ width: '700px', height: '528px' });
    });

    scrollHeight = 420;
    act(() => {
      if (resizeObserverCallback && resizeObserverInstance) {
        resizeObserverCallback([], resizeObserverInstance);
      }
    });

    await waitFor(() => {
      expect(dialog).toHaveStyle({ height: '448px' });
    });
  });

  it('clamps to minWidth when content is narrower', async () => {
    scrollHeight = 300;
    scrollWidth = 200;

    render(
      <FloatingWindow
        {...defaultProps}
        fitContent
        minWidth={350}
        maxWidthPercent={1}
        maxHeightPercent={1}
      />
    );

    const dialog = screen.getByRole('dialog');

    await waitFor(() => {
      expect(dialog).toHaveStyle({ width: '350px' });
    });
  });

  it('clamps to maxWidthPercent when content is wider', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1000
    });

    scrollHeight = 300;
    scrollWidth = 1200;

    render(
      <FloatingWindow
        {...defaultProps}
        fitContent
        maxWidthPercent={0.6}
        maxHeightPercent={1}
      />
    );

    const dialog = screen.getByRole('dialog');

    await waitFor(() => {
      expect(dialog).toHaveStyle({ width: '600px' });
    });
  });

  it('stops resizing after the fit stabilizes', async () => {
    scrollHeight = 400;
    scrollWidth = 700;

    render(
      <FloatingWindow
        {...defaultProps}
        fitContent
        maxWidthPercent={1}
        maxHeightPercent={1}
      />
    );

    const dialog = screen.getByRole('dialog');

    await waitFor(() => {
      expect(dialog).toHaveStyle({ width: '700px', height: '428px' });
    });

    act(() => {
      if (resizeObserverCallback && resizeObserverInstance) {
        resizeObserverCallback([], resizeObserverInstance);
      }
    });

    scrollHeight = 200;
    act(() => {
      if (resizeObserverCallback && resizeObserverInstance) {
        resizeObserverCallback([], resizeObserverInstance);
      }
    });

    await waitFor(() => {
      expect(dialog).toHaveStyle({ height: '428px' });
    });
  });

  it('disconnects observer after max fit attempts', async () => {
    scrollHeight = 360;
    scrollWidth = 520;

    render(
      <FloatingWindow
        {...defaultProps}
        fitContent
        maxWidthPercent={1}
        maxHeightPercent={1}
      />
    );

    const dialog = screen.getByRole('dialog');

    await waitFor(() => {
      expect(dialog).toHaveStyle({ width: '520px', height: '388px' });
    });

    for (let i = 0; i < 4; i += 1) {
      scrollHeight += 10;
      scrollWidth += 10;
      act(() => {
        if (resizeObserverCallback && resizeObserverInstance) {
          resizeObserverCallback([], resizeObserverInstance);
        }
      });
    }

    await waitFor(() => {
      expect(resizeObserverInstance?.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
