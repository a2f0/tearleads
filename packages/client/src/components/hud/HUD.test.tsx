import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HUD } from './HUD';

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: false
  })
}));

vi.mock('./AnalyticsTab', () => ({
  AnalyticsTab: () => <div data-testid="analytics-tab">Analytics Tab</div>
}));

vi.mock('./LogsTab', () => ({
  LogsTab: () => <div data-testid="logs-tab">Logs Tab</div>
}));

describe('HUD', () => {
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

  it('renders nothing when closed', () => {
    const { container } = render(<HUD isOpen={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders when open', () => {
    render(<HUD isOpen={true} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows logs tab by default', () => {
    render(<HUD isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('logs-tab')).toBeInTheDocument();
  });

  it('switches to logs tab when clicked', async () => {
    const user = userEvent.setup();
    render(<HUD isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /logs/i }));
    expect(screen.getByTestId('logs-tab')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HUD isOpen={true} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders backdrop when open', () => {
    render(<HUD isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('hud-backdrop')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HUD isOpen={true} onClose={onClose} />);

    await user.click(screen.getByTestId('hud-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render backdrop when closed', () => {
    render(<HUD isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('hud-backdrop')).not.toBeInTheDocument();
  });

  describe('title bar', () => {
    it('renders title bar when open', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      expect(screen.getByTestId('hud-title-bar')).toBeInTheDocument();
    });

    it('displays HUD text in title bar', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      expect(screen.getByText('HUD')).toBeInTheDocument();
    });

    it('allows dragging the window via title bar on desktop', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const titleBar = screen.getByTestId('hud-title-bar');

      const initialLeft = parseInt(dialog.style.left, 10);
      const initialTop = parseInt(dialog.style.top, 10);

      // Drag window toward top-left where there's room to move
      fireEvent.mouseDown(titleBar, { clientX: 500, clientY: 300 });
      fireEvent.mouseMove(document, { clientX: 400, clientY: 250 });
      fireEvent.mouseUp(document);

      const newLeft = parseInt(dialog.style.left, 10);
      const newTop = parseInt(dialog.style.top, 10);

      // Position should decrease (moved left and up)
      expect(newLeft).toBe(initialLeft - 100);
      expect(newTop).toBe(initialTop - 50);
    });

    it('handles touch-based dragging on desktop', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const titleBar = screen.getByTestId('hud-title-bar');

      const initialLeft = parseInt(dialog.style.left, 10);
      const initialTop = parseInt(dialog.style.top, 10);

      // Drag window toward top-left where there's room to move
      fireEvent.touchStart(titleBar, {
        touches: [{ clientX: 500, clientY: 300, identifier: 0 }]
      });
      fireEvent.touchMove(document, {
        touches: [{ clientX: 400, clientY: 250, identifier: 0 }]
      });
      fireEvent.touchEnd(document);

      const newLeft = parseInt(dialog.style.left, 10);
      const newTop = parseInt(dialog.style.top, 10);

      // Position should decrease (moved left and up)
      expect(newLeft).toBe(initialLeft - 100);
      expect(newTop).toBe(initialTop - 50);
    });
  });

  describe('resize handles', () => {
    it('renders all 4 corner resize handles on desktop', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      expect(
        screen.getByTestId('hud-resize-handle-top-left')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('hud-resize-handle-top-right')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('hud-resize-handle-bottom-left')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('hud-resize-handle-bottom-right')
      ).toBeInTheDocument();
    });

    it('changes size when bottom-right corner is dragged', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle-bottom-right');

      const initialWidth = parseInt(dialog.style.width, 10);
      const initialHeight = parseInt(dialog.style.height, 10);

      fireEvent.mouseDown(handle, { clientX: 500, clientY: 400 });
      fireEvent.mouseMove(document, { clientX: 600, clientY: 500 });
      fireEvent.mouseUp(document);

      const newWidth = parseInt(dialog.style.width, 10);
      const newHeight = parseInt(dialog.style.height, 10);

      expect(newWidth).toBe(initialWidth + 100);
      expect(newHeight).toBe(initialHeight + 100);
    });

    it('changes size when top-left corner is dragged', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle-top-left');

      const initialWidth = parseInt(dialog.style.width, 10);
      const initialHeight = parseInt(dialog.style.height, 10);
      const initialLeft = parseInt(dialog.style.left, 10);
      const initialTop = parseInt(dialog.style.top, 10);

      fireEvent.mouseDown(handle, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });
      fireEvent.mouseUp(document);

      const newWidth = parseInt(dialog.style.width, 10);
      const newHeight = parseInt(dialog.style.height, 10);
      const newLeft = parseInt(dialog.style.left, 10);
      const newTop = parseInt(dialog.style.top, 10);

      expect(newWidth).toBe(initialWidth + 50);
      expect(newHeight).toBe(initialHeight + 50);
      expect(newLeft).toBe(initialLeft - 50);
      expect(newTop).toBe(initialTop - 50);
    });

    it('respects minimum size constraints', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle-bottom-right');

      fireEvent.mouseDown(handle, { clientX: 500, clientY: 400 });
      fireEvent.mouseMove(document, { clientX: 0, clientY: 0 });
      fireEvent.mouseUp(document);

      const newWidth = parseInt(dialog.style.width, 10);
      const newHeight = parseInt(dialog.style.height, 10);

      expect(newWidth).toBeGreaterThanOrEqual(280);
      expect(newHeight).toBeGreaterThanOrEqual(150);
    });

    it('respects maximum size constraints', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle-bottom-right');

      fireEvent.mouseDown(handle, { clientX: 500, clientY: 400 });
      fireEvent.mouseMove(document, { clientX: 2000, clientY: 2000 });
      fireEvent.mouseUp(document);

      const newWidth = parseInt(dialog.style.width, 10);
      const newHeight = parseInt(dialog.style.height, 10);

      expect(newWidth).toBeLessThanOrEqual(window.innerWidth * 0.6);
      expect(newHeight).toBeLessThanOrEqual(window.innerHeight * 0.7);
    });

    it('handles touch-based resizing', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle-bottom-right');

      const initialWidth = parseInt(dialog.style.width, 10);
      const initialHeight = parseInt(dialog.style.height, 10);

      fireEvent.touchStart(handle, {
        touches: [{ clientX: 500, clientY: 400, identifier: 0 }]
      });
      fireEvent.touchMove(document, {
        touches: [{ clientX: 600, clientY: 500, identifier: 0 }]
      });
      fireEvent.touchEnd(document);

      const newWidth = parseInt(dialog.style.width, 10);
      const newHeight = parseInt(dialog.style.height, 10);

      expect(newWidth).toBe(initialWidth + 100);
      expect(newHeight).toBe(initialHeight + 100);
    });

    it('handles touchStart with no touches', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle-bottom-right');

      const initialWidth = parseInt(dialog.style.width, 10);

      fireEvent.touchStart(handle, { touches: [] });

      const newWidth = parseInt(dialog.style.width, 10);
      expect(newWidth).toBe(initialWidth);
    });

    it('handles touchMove with no touches', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle-bottom-right');

      const initialWidth = parseInt(dialog.style.width, 10);

      fireEvent.touchStart(handle, {
        touches: [{ clientX: 500, clientY: 400, identifier: 0 }]
      });
      fireEvent.touchMove(document, { touches: [] });
      fireEvent.touchEnd(document);

      const newWidth = parseInt(dialog.style.width, 10);
      expect(newWidth).toBe(initialWidth);
    });

    it('ignores move events when not dragging', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');

      const initialWidth = parseInt(dialog.style.width, 10);

      fireEvent.mouseMove(document, { clientX: 200, clientY: 200 });

      const newWidth = parseInt(dialog.style.width, 10);
      expect(newWidth).toBe(initialWidth);
    });

    it('handles drag end when not dragging', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');

      const initialWidth = parseInt(dialog.style.width, 10);

      fireEvent.mouseUp(document);

      const newWidth = parseInt(dialog.style.width, 10);
      expect(newWidth).toBe(initialWidth);
    });
  });

  describe('mobile behavior', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375
      });
    });

    it('does not render corner resize handles on mobile', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      expect(
        screen.queryByTestId('hud-resize-handle-top-left')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('hud-resize-handle-bottom-right')
      ).not.toBeInTheDocument();
    });

    it('renders title bar on mobile', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      expect(screen.getByTestId('hud-title-bar')).toBeInTheDocument();
    });
  });
});
