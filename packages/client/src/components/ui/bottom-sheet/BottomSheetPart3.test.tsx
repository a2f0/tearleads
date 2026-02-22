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
