import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
