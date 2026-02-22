import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ANIMATION_DURATION_MS, BottomSheet } from './BottomSheet';

type GestureCallback = (detail: { deltaY: number; velocityY: number }) => void;

interface MockGestureCallbacks {
  onStart: GestureCallback;
  onMove: GestureCallback;
  onEnd: GestureCallback;
}

let mockGestureCallbacks: MockGestureCallbacks | null = null;
const mockCreateGesture = vi.fn();

vi.mock('@ionic/core', () => ({
  createGesture: (options: MockGestureCallbacks) => {
    mockCreateGesture(options);
    mockGestureCallbacks = {
      onStart: options.onStart,
      onMove: options.onMove,
      onEnd: options.onEnd
    };
    return {
      enable: vi.fn(),
      destroy: vi.fn()
    };
  }
}));

async function simulateGestureDrag(deltaY: number, velocityY: number = 0) {
  if (!mockGestureCallbacks) {
    throw new Error('Gesture not initialized');
  }

  await act(async () => {
    mockGestureCallbacks?.onStart({ deltaY: 0, velocityY: 0 });
    mockGestureCallbacks?.onMove({ deltaY, velocityY: 0 });
    mockGestureCallbacks?.onEnd({ deltaY, velocityY });
  });
}

describe('BottomSheet', () => {
  beforeEach(() => {
    mockGestureCallbacks = null;
    mockCreateGesture.mockClear();

    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 1000
    });
  });

  it('renders nothing when not open', () => {
    render(
      <BottomSheet open={false} onOpenChange={() => {}}>
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.queryByTestId('bottom-sheet')).not.toBeInTheDocument();
  });

  it('renders content when open', () => {
    render(
      <BottomSheet open={true} onOpenChange={() => {}}>
        <p>Sheet content</p>
      </BottomSheet>
    );

    expect(screen.getByTestId('bottom-sheet')).toBeInTheDocument();
    expect(screen.getByText('Sheet content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <BottomSheet open={true} onOpenChange={() => {}} title="Test Title">
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('does not render title when not provided', () => {
    render(
      <BottomSheet open={true} onOpenChange={() => {}}>
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('calls onOpenChange with false when backdrop clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <BottomSheet open={true} onOpenChange={onOpenChange}>
        <p>Content</p>
      </BottomSheet>
    );

    await user.click(screen.getByTestId('bottom-sheet-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange with false when Escape pressed', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <BottomSheet open={true} onOpenChange={onOpenChange}>
        <p>Content</p>
      </BottomSheet>
    );

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not call onOpenChange when non-Escape key pressed', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <BottomSheet open={true} onOpenChange={onOpenChange}>
        <p>Content</p>
      </BottomSheet>
    );

    await user.keyboard('a');

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('has correct accessibility attributes', () => {
    render(
      <BottomSheet open={true} onOpenChange={() => {}} title="Accessible Title">
        <p>Content</p>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('uses custom data-testid when provided', () => {
    render(
      <BottomSheet
        open={true}
        onOpenChange={() => {}}
        data-testid="custom-sheet"
      >
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.getByTestId('custom-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('custom-sheet-backdrop')).toBeInTheDocument();
    expect(screen.getByTestId('custom-sheet-content')).toBeInTheDocument();
  });

  it('uses custom maxHeightPercent for sizing', () => {
    render(
      <BottomSheet open={true} onOpenChange={() => {}} maxHeightPercent={0.9}>
        <p>Content</p>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ maxHeight: '90vh' });
  });

  it('unmounts after close animation', async () => {
    const { rerender } = render(
      <BottomSheet open={true} onOpenChange={() => {}}>
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.getByTestId('bottom-sheet')).toBeInTheDocument();

    rerender(
      <BottomSheet open={false} onOpenChange={() => {}}>
        <p>Content</p>
      </BottomSheet>
    );

    await waitFor(
      () => {
        expect(screen.queryByTestId('bottom-sheet')).not.toBeInTheDocument();
      },
      { timeout: ANIMATION_DURATION_MS + 100 }
    );
  });

  describe('resize handle', () => {
    it('renders resize handle when open', () => {
      render(
        <BottomSheet open={true} onOpenChange={() => {}}>
          <p>Content</p>
        </BottomSheet>
      );
      expect(
        screen.getByTestId('bottom-sheet-resize-handle')
      ).toBeInTheDocument();
    });

    it('has correct accessibility attributes', () => {
      render(
        <BottomSheet open={true} onOpenChange={() => {}}>
          <p>Content</p>
        </BottomSheet>
      );
      const handle = screen.getByTestId('bottom-sheet-resize-handle');
      expect(handle.tagName).toBe('DIV');
      expect(handle).toHaveAttribute('role', 'slider');
      expect(handle).toHaveAttribute('aria-label', 'Resize handle');
      expect(handle).toHaveAttribute('tabindex', '0');
    });

    it('changes height when dragged upward', async () => {
      render(
        <BottomSheet open={true} onOpenChange={() => {}}>
          <p>Content</p>
        </BottomSheet>
      );
      const dialog = screen.getByRole('dialog');
      const initialHeight = parseInt(dialog.style.height, 10);

      await simulateGestureDrag(-100, 0);

      await waitFor(() => {
        const newHeight = parseInt(dialog.style.height, 10);
        expect(newHeight).toBeGreaterThan(initialHeight);
      });
    });

    it('uses custom data-testid for resize handle', () => {
      render(
        <BottomSheet
          open={true}
          onOpenChange={() => {}}
          data-testid="custom-sheet"
        >
          <p>Content</p>
        </BottomSheet>
      );
      expect(
        screen.getByTestId('custom-sheet-resize-handle')
      ).toBeInTheDocument();
    });
  });
});
