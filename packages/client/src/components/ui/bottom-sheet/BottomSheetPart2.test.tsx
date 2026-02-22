import { act, render, screen, waitFor } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi
} from 'vitest';
import { BottomSheet } from './BottomSheet';

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
});
