import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

  describe('resize handle', () => {
    it('renders resize handle when open', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      expect(screen.getByTestId('hud-resize-handle')).toBeInTheDocument();
    });

    it('has correct accessibility attributes', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const handle = screen.getByTestId('hud-resize-handle');
      expect(handle.tagName).toBe('BUTTON');
      expect(handle).toHaveAttribute('aria-label', 'Resize handle');
    });

    it('changes height when dragged', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle');

      const initialHeight = parseInt(dialog.style.height, 10);

      fireEvent.mouseDown(handle, { clientY: 300 });
      fireEvent.mouseMove(document, { clientY: 200 });
      fireEvent.mouseUp(document);

      const newHeight = parseInt(dialog.style.height, 10);
      expect(newHeight).toBeGreaterThan(initialHeight);
    });

    it('respects minimum height constraint', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle');

      fireEvent.mouseDown(handle, { clientY: 300 });
      fireEvent.mouseMove(document, { clientY: 1000 });
      fireEvent.mouseUp(document);

      const newHeight = parseInt(dialog.style.height, 10);
      expect(newHeight).toBeGreaterThanOrEqual(150);
    });

    it('respects maximum height constraint', () => {
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 1000
      });

      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle');

      fireEvent.mouseDown(handle, { clientY: 500 });
      fireEvent.mouseMove(document, { clientY: -500 });
      fireEvent.mouseUp(document);

      const newHeight = parseInt(dialog.style.height, 10);
      expect(newHeight).toBeLessThanOrEqual(700);
    });

    it('handles touch-based resizing', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle');

      const initialHeight = parseInt(dialog.style.height, 10);

      fireEvent.touchStart(handle, {
        touches: [{ clientY: 300, identifier: 0 }]
      });
      fireEvent.touchMove(document, {
        touches: [{ clientY: 200, identifier: 0 }]
      });
      fireEvent.touchEnd(document);

      const newHeight = parseInt(dialog.style.height, 10);
      expect(newHeight).toBeGreaterThan(initialHeight);
    });

    it('handles touchStart with no touches', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle');

      const initialHeight = parseInt(dialog.style.height, 10);

      fireEvent.touchStart(handle, { touches: [] });

      const newHeight = parseInt(dialog.style.height, 10);
      expect(newHeight).toBe(initialHeight);
    });

    it('handles touchMove with no touches', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      const handle = screen.getByTestId('hud-resize-handle');

      const initialHeight = parseInt(dialog.style.height, 10);

      fireEvent.touchStart(handle, {
        touches: [{ clientY: 300, identifier: 0 }]
      });
      fireEvent.touchMove(document, { touches: [] });
      fireEvent.touchEnd(document);

      const newHeight = parseInt(dialog.style.height, 10);
      expect(newHeight).toBe(initialHeight);
    });

    it('ignores move events when not dragging', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');

      const initialHeight = parseInt(dialog.style.height, 10);

      fireEvent.mouseMove(document, { clientY: 200 });

      const newHeight = parseInt(dialog.style.height, 10);
      expect(newHeight).toBe(initialHeight);
    });

    it('handles drag end when not dragging', () => {
      render(<HUD isOpen={true} onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');

      const initialHeight = parseInt(dialog.style.height, 10);

      fireEvent.mouseUp(document);

      const newHeight = parseInt(dialog.style.height, 10);
      expect(newHeight).toBe(initialHeight);
    });
  });
});
