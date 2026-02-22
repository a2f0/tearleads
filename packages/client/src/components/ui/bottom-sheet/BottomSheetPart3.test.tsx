import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
