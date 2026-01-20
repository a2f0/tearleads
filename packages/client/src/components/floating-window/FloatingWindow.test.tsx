import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingWindow } from './FloatingWindow';

describe('FloatingWindow', () => {
  const defaultProps = {
    id: 'test-window',
    title: 'Test Window',
    onClose: vi.fn(),
    children: <div data-testid="window-content">Content</div>
  };

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
  });

  it('renders with title and children', () => {
    render(<FloatingWindow {...defaultProps} />);
    expect(screen.getByText('Test Window')).toBeInTheDocument();
    expect(screen.getByTestId('window-content')).toBeInTheDocument();
  });

  it('renders as a dialog', () => {
    render(<FloatingWindow {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FloatingWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders with custom dimensions', () => {
    render(
      <FloatingWindow
        {...defaultProps}
        defaultWidth={500}
        defaultHeight={400}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ width: '500px', height: '400px' });
  });

  it('renders with custom position', () => {
    render(<FloatingWindow {...defaultProps} defaultX={100} defaultY={50} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ left: '100px', top: '50px' });
  });

  it('renders resize handles', () => {
    render(<FloatingWindow {...defaultProps} />);
    expect(
      screen.getByTestId('floating-window-test-window-resize-handle-top-left')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('floating-window-test-window-resize-handle-top-right')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        'floating-window-test-window-resize-handle-bottom-left'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        'floating-window-test-window-resize-handle-bottom-right'
      )
    ).toBeInTheDocument();
  });

  it('calls onFocus when clicked', async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    render(<FloatingWindow {...defaultProps} onFocus={onFocus} />);

    await user.click(screen.getByRole('dialog'));
    expect(onFocus).toHaveBeenCalled();
  });

  it('allows dragging via title bar', () => {
    render(<FloatingWindow {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    const initialLeft = Number.parseInt(dialog.style.left, 10);
    const initialTop = Number.parseInt(dialog.style.top, 10);

    fireEvent.mouseDown(titleBar, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(document, { clientX: 300, clientY: 250 });
    fireEvent.mouseUp(document);

    const newLeft = Number.parseInt(dialog.style.left, 10);
    const newTop = Number.parseInt(dialog.style.top, 10);

    expect(newLeft).toBe(initialLeft + 100);
    expect(newTop).toBe(initialTop + 50);
  });

  it('allows resizing via corner handles', () => {
    render(<FloatingWindow {...defaultProps} defaultWidth={400} />);
    const dialog = screen.getByRole('dialog');
    const handle = screen.getByTestId(
      'floating-window-test-window-resize-handle-bottom-right'
    );

    const initialWidth = Number.parseInt(dialog.style.width, 10);
    const initialHeight = Number.parseInt(dialog.style.height, 10);

    fireEvent.mouseDown(handle, { clientX: 500, clientY: 400 });
    fireEvent.mouseMove(document, { clientX: 600, clientY: 500 });
    fireEvent.mouseUp(document);

    const newWidth = Number.parseInt(dialog.style.width, 10);
    const newHeight = Number.parseInt(dialog.style.height, 10);

    expect(newWidth).toBe(initialWidth + 100);
    expect(newHeight).toBe(initialHeight + 100);
  });

  it('respects minimum size constraints', () => {
    render(<FloatingWindow {...defaultProps} minWidth={200} minHeight={150} />);
    const dialog = screen.getByRole('dialog');
    const handle = screen.getByTestId(
      'floating-window-test-window-resize-handle-bottom-right'
    );

    fireEvent.mouseDown(handle, { clientX: 500, clientY: 400 });
    fireEvent.mouseMove(document, { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(document);

    const newWidth = Number.parseInt(dialog.style.width, 10);
    const newHeight = Number.parseInt(dialog.style.height, 10);

    expect(newWidth).toBeGreaterThanOrEqual(200);
    expect(newHeight).toBeGreaterThanOrEqual(150);
  });

  it('applies custom zIndex', () => {
    render(<FloatingWindow {...defaultProps} zIndex={150} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ zIndex: '150' });
  });

  it('handles touch-based dragging', () => {
    render(<FloatingWindow {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    const initialLeft = Number.parseInt(dialog.style.left, 10);
    const initialTop = Number.parseInt(dialog.style.top, 10);

    fireEvent.touchStart(titleBar, {
      touches: [{ clientX: 200, clientY: 200, identifier: 0 }]
    });
    fireEvent.touchMove(document, {
      touches: [{ clientX: 300, clientY: 250, identifier: 0 }]
    });
    fireEvent.touchEnd(document);

    const newLeft = Number.parseInt(dialog.style.left, 10);
    const newTop = Number.parseInt(dialog.style.top, 10);

    expect(newLeft).toBe(initialLeft + 100);
    expect(newTop).toBe(initialTop + 50);
  });

  it('renders minimize button when onMinimize is provided', () => {
    const onMinimize = vi.fn();
    render(<FloatingWindow {...defaultProps} onMinimize={onMinimize} />);
    expect(
      screen.getByRole('button', { name: /minimize/i })
    ).toBeInTheDocument();
  });

  it('calls onMinimize with dimensions when minimize button is clicked', async () => {
    const user = userEvent.setup();
    const onMinimize = vi.fn();
    render(
      <FloatingWindow
        {...defaultProps}
        onMinimize={onMinimize}
        defaultWidth={500}
        defaultHeight={400}
        defaultX={100}
        defaultY={50}
      />
    );

    await user.click(screen.getByRole('button', { name: /minimize/i }));
    expect(onMinimize).toHaveBeenCalledWith({
      width: 500,
      height: 400,
      x: 100,
      y: 50
    });
  });

  it('renders maximize button on desktop', () => {
    render(<FloatingWindow {...defaultProps} />);
    expect(
      screen.getByRole('button', { name: /maximize/i })
    ).toBeInTheDocument();
  });

  it('maximizes window on double-click of title bar', () => {
    render(<FloatingWindow {...defaultProps} defaultWidth={400} />);
    const dialog = screen.getByRole('dialog');
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    fireEvent.doubleClick(titleBar);

    expect(dialog).toHaveAttribute('data-maximized', 'true');
  });

  it('reports maximize state in dimensions change callback', async () => {
    const user = userEvent.setup();
    const onDimensionsChange = vi.fn();
    render(
      <FloatingWindow
        {...defaultProps}
        onDimensionsChange={onDimensionsChange}
        defaultWidth={400}
        defaultHeight={300}
        defaultX={100}
        defaultY={50}
      />
    );
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    fireEvent.doubleClick(titleBar);

    expect(onDimensionsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 0,
        y: 0,
        isMaximized: true
      })
    );

    await user.click(screen.getByRole('button', { name: /restore/i }));

    const lastCall = onDimensionsChange.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual(expect.objectContaining({ isMaximized: false }));
    expect(lastCall?.x).toBeGreaterThan(0);
    expect(lastCall?.y).toBeGreaterThan(0);
    expect(lastCall?.width).toBeLessThan(window.innerWidth);
    expect(lastCall?.height).toBeLessThan(window.innerHeight);
  });

  it('restores window from maximized state', async () => {
    const user = userEvent.setup();
    render(<FloatingWindow {...defaultProps} defaultWidth={400} />);
    const dialog = screen.getByRole('dialog');
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    // Maximize
    fireEvent.doubleClick(titleBar);
    expect(dialog).toHaveAttribute('data-maximized', 'true');

    // Restore via button
    await user.click(screen.getByRole('button', { name: /restore/i }));
    expect(dialog).toHaveAttribute('data-maximized', 'false');
  });

  it('uses initial dimensions from props', () => {
    render(
      <FloatingWindow
        {...defaultProps}
        initialDimensions={{ width: 600, height: 500, x: 150, y: 100 }}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({
      width: '600px',
      height: '500px',
      left: '150px',
      top: '100px'
    });
  });

  it('restores to maximized state from initial dimensions', () => {
    render(
      <FloatingWindow
        {...defaultProps}
        initialDimensions={{
          width: 1024,
          height: 768,
          x: 0,
          y: 0,
          isMaximized: true,
          preMaximizeDimensions: { width: 400, height: 300, x: 100, y: 50 }
        }}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-maximized', 'true');
  });

  it('includes maximize state in minimize callback when maximized', async () => {
    const user = userEvent.setup();
    const onMinimize = vi.fn();
    render(
      <FloatingWindow
        {...defaultProps}
        onMinimize={onMinimize}
        defaultWidth={400}
        defaultHeight={300}
        defaultX={100}
        defaultY={50}
      />
    );

    // First maximize
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );
    fireEvent.doubleClick(titleBar);

    // Then minimize
    await user.click(screen.getByRole('button', { name: /minimize/i }));

    expect(onMinimize).toHaveBeenCalledWith(
      expect.objectContaining({
        isMaximized: true,
        preMaximizeDimensions: { width: 400, height: 300, x: 100, y: 50 }
      })
    );
  });

  it('does not render resize handles when maximized', () => {
    render(<FloatingWindow {...defaultProps} defaultWidth={400} />);
    const titleBar = screen.getByTestId(
      'floating-window-test-window-title-bar'
    );

    // Maximize
    fireEvent.doubleClick(titleBar);

    expect(
      screen.queryByTestId('floating-window-test-window-resize-handle-top-left')
    ).not.toBeInTheDocument();
  });

  describe('mobile mode', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 600
      });
    });

    it('does not render maximize button on mobile', () => {
      render(<FloatingWindow {...defaultProps} />);
      expect(
        screen.queryByRole('button', { name: /maximize/i })
      ).not.toBeInTheDocument();
    });

    it('does not render resize handles on mobile', () => {
      render(<FloatingWindow {...defaultProps} />);
      expect(
        screen.queryByTestId(
          'floating-window-test-window-resize-handle-top-left'
        )
      ).not.toBeInTheDocument();
    });
  });

  describe('responsive behavior', () => {
    it('updates to desktop mode when window is resized', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 600
      });

      render(<FloatingWindow {...defaultProps} />);

      // Should be mobile mode initially
      expect(
        screen.queryByRole('button', { name: /maximize/i })
      ).not.toBeInTheDocument();

      // Resize to desktop
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1024
      });

      fireEvent(window, new Event('resize'));

      // Should now be desktop mode
      expect(
        screen.getByRole('button', { name: /maximize/i })
      ).toBeInTheDocument();
    });
  });

  describe('fitContent behavior', () => {
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
      // FOOTER_HEIGHT=56, window: 1024x768
      // maxHeight = (768 - 56) * 1 = 712
      // height = min(900 + 28, 712) = 712 (clamped)
      // width = 700 (fits within 1024)
      // x = (1024 - 700) / 2 = 162
      // y = (688 - 688) / 2 = 0
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
  });
});
