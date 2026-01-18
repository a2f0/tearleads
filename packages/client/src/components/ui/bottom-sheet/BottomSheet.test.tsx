import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi
} from 'vitest';
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

  describe('gesture behavior', () => {
    it('initializes Ionic gesture on mount', () => {
      render(
        <BottomSheet open={true} onOpenChange={() => {}}>
          <p>Content</p>
        </BottomSheet>
      );

      expect(mockCreateGesture).toHaveBeenCalled();
      const gestureOptions = (mockCreateGesture as Mock).mock.calls[0]?.[0] as {
        gestureName: string;
        direction: string;
      };
      expect(gestureOptions.gestureName).toBe('bottom-sheet-drag');
      expect(gestureOptions.direction).toBe('y');
    });

    it('dismisses on fast downward flick', async () => {
      const onOpenChange = vi.fn();

      render(
        <BottomSheet open={true} onOpenChange={onOpenChange}>
          <p>Content</p>
        </BottomSheet>
      );

      await simulateGestureDrag(50, 1.0);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('dismisses when dragged down past threshold', async () => {
      const onOpenChange = vi.fn();

      render(
        <BottomSheet open={true} onOpenChange={onOpenChange}>
          <p>Content</p>
        </BottomSheet>
      );

      await simulateGestureDrag(150, 0);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('accepts custom snap points', () => {
      const customSnapPoints = [
        { name: 'small', height: 100 },
        { name: 'large', height: 500 }
      ];

      render(
        <BottomSheet
          open={true}
          onOpenChange={() => {}}
          snapPoints={customSnapPoints}
          initialSnapPoint="small"
        >
          <p>Content</p>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      const height = parseInt(dialog.style.height, 10);
      expect(height).toBe(100);
    });

    it('expands on fast upward flick', async () => {
      vi.useFakeTimers();
      const customSnapPoints = [
        { name: 'small', height: 100 },
        { name: 'medium', height: 300 },
        { name: 'large', height: 500 }
      ];

      render(
        <BottomSheet
          open={true}
          onOpenChange={() => {}}
          snapPoints={customSnapPoints}
          initialSnapPoint="small"
        >
          <p>Content</p>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      expect(parseInt(dialog.style.height, 10)).toBe(100);

      await simulateGestureDrag(-50, -1.0);

      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      expect(parseInt(dialog.style.height, 10)).toBe(300);
      vi.useRealTimers();
    });

    it('snaps to nearest point on slow drag release', async () => {
      vi.useFakeTimers();
      const customSnapPoints = [
        { name: 'small', height: 100 },
        { name: 'large', height: 400 }
      ];

      render(
        <BottomSheet
          open={true}
          onOpenChange={() => {}}
          snapPoints={customSnapPoints}
          initialSnapPoint="small"
        >
          <p>Content</p>
        </BottomSheet>
      );

      await simulateGestureDrag(-50, 0.1);

      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      const dialog = screen.getByRole('dialog');
      expect(parseInt(dialog.style.height, 10)).toBe(100);
      vi.useRealTimers();
    });

    it('snaps to top snap point when flicking up from highest point', async () => {
      vi.useFakeTimers();
      const customSnapPoints = [
        { name: 'small', height: 100 },
        { name: 'large', height: 400 }
      ];

      render(
        <BottomSheet
          open={true}
          onOpenChange={() => {}}
          snapPoints={customSnapPoints}
          initialSnapPoint="large"
        >
          <p>Content</p>
        </BottomSheet>
      );

      await simulateGestureDrag(-50, -1.0);

      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      const dialog = screen.getByRole('dialog');
      expect(parseInt(dialog.style.height, 10)).toBe(400);
      vi.useRealTimers();
    });

    it('handles flick down when at lowest snap point', async () => {
      vi.useFakeTimers();
      const onOpenChange = vi.fn();
      const customSnapPoints = [
        { name: 'small', height: 100 },
        { name: 'large', height: 400 }
      ];

      render(
        <BottomSheet
          open={true}
          onOpenChange={onOpenChange}
          snapPoints={customSnapPoints}
          initialSnapPoint="small"
        >
          <p>Content</p>
        </BottomSheet>
      );

      await simulateGestureDrag(30, 0.8);

      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      expect(onOpenChange).toHaveBeenCalledWith(false);
      vi.useRealTimers();
    });

    it('finds nearest snap point when gesture ends without velocity', async () => {
      vi.useFakeTimers();
      const customSnapPoints = [
        { name: 'small', height: 100 },
        { name: 'medium', height: 250 },
        { name: 'large', height: 400 }
      ];

      render(
        <BottomSheet
          open={true}
          onOpenChange={() => {}}
          snapPoints={customSnapPoints}
          initialSnapPoint="small"
        >
          <p>Content</p>
        </BottomSheet>
      );

      await simulateGestureDrag(-120, 0.2);

      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      const dialog = screen.getByRole('dialog');
      expect(parseInt(dialog.style.height, 10)).toBe(250);
      vi.useRealTimers();
    });

    it('snaps to lower point when dragged down from middle', async () => {
      vi.useFakeTimers();
      const customSnapPoints = [
        { name: 'small', height: 100 },
        { name: 'medium', height: 250 },
        { name: 'large', height: 400 }
      ];

      render(
        <BottomSheet
          open={true}
          onOpenChange={() => {}}
          snapPoints={customSnapPoints}
          initialSnapPoint="medium"
        >
          <p>Content</p>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      expect(parseInt(dialog.style.height, 10)).toBe(250);

      await simulateGestureDrag(80, 0.2);

      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      expect(parseInt(dialog.style.height, 10)).toBe(100);
      vi.useRealTimers();
    });

    it('handles flicking up with no onDismiss callback', async () => {
      vi.useFakeTimers();
      const customSnapPoints = [{ name: 'only', height: 200 }];

      render(
        <BottomSheet
          open={true}
          onOpenChange={() => {}}
          snapPoints={customSnapPoints}
          initialSnapPoint="only"
        >
          <p>Content</p>
        </BottomSheet>
      );

      await simulateGestureDrag(-50, -0.8);

      await act(async () => {
        vi.advanceTimersByTime(350);
      });

      const dialog = screen.getByRole('dialog');
      expect(parseInt(dialog.style.height, 10)).toBe(200);
      vi.useRealTimers();
    });
  });

  describe('fitContent behavior', () => {
    let mockObserve: Mock;
    let mockDisconnect: Mock;
    const originalResizeObserver = global.ResizeObserver;

    beforeEach(() => {
      mockObserve = vi.fn();
      mockDisconnect = vi.fn();

      class MockResizeObserver implements ResizeObserver {
        observe = mockObserve;
        unobserve = vi.fn();
        disconnect = mockDisconnect;
      }

      global.ResizeObserver = MockResizeObserver;
    });

    afterEach(() => {
      global.ResizeObserver = originalResizeObserver;
    });

    it('renders with fitContent prop', () => {
      render(
        <BottomSheet open={true} onOpenChange={() => {}} fitContent>
          <div>Content</div>
        </BottomSheet>
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('sets up ResizeObserver on content container when fitContent is true', () => {
      render(
        <BottomSheet open={true} onOpenChange={() => {}} fitContent>
          <p>Content</p>
        </BottomSheet>
      );

      expect(mockObserve).toHaveBeenCalled();
    });

    it('does not set up ResizeObserver when fitContent is false', () => {
      render(
        <BottomSheet open={true} onOpenChange={() => {}}>
          <p>Content</p>
        </BottomSheet>
      );

      expect(mockObserve).not.toHaveBeenCalled();
    });

    it('disconnects ResizeObserver on unmount', () => {
      const { unmount } = render(
        <BottomSheet open={true} onOpenChange={() => {}} fitContent>
          <p>Content</p>
        </BottomSheet>
      );

      unmount();

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('uses default snap points when fitContent is false', () => {
      render(
        <BottomSheet open={true} onOpenChange={() => {}}>
          <p>Content</p>
        </BottomSheet>
      );

      const dialog = screen.getByRole('dialog');
      const height = parseInt(dialog.style.height, 10);

      // Default collapsed height is 200
      expect(height).toBe(200);
    });

    it('renders content container with ref for measurement', () => {
      render(
        <BottomSheet open={true} onOpenChange={() => {}} fitContent>
          <p>Test content</p>
        </BottomSheet>
      );

      const contentContainer = screen
        .getByRole('dialog')
        .querySelector('.overflow-y-auto');
      expect(contentContainer).toBeInTheDocument();
      expect(contentContainer).toHaveTextContent('Test content');
    });
  });

  describe('window resize', () => {
    it('updates windowHeight state when window is resized', async () => {
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 768
      });

      render(
        <BottomSheet open={true} onOpenChange={() => {}}>
          <p>Content</p>
        </BottomSheet>
      );

      // Resize the window
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 1024
      });

      await act(async () => {
        window.dispatchEvent(new Event('resize'));
      });

      // Sheet should still be rendered after resize
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
