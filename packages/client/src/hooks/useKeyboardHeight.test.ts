import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock functions that will be used by the mock
const mockRemove = vi.fn();
let keyboardWillShowCallback:
  | ((info: { keyboardHeight: number }) => void)
  | null = null;
let keyboardWillHideCallback: (() => void) | null = null;
let mockIsNativePlatform = true;

// Mock the Capacitor core
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform
  }
}));

// Mock the Capacitor Keyboard plugin
vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: vi.fn((event: string, callback: unknown) => {
      if (event === 'keyboardWillShow') {
        keyboardWillShowCallback = callback as (info: {
          keyboardHeight: number;
        }) => void;
      } else if (event === 'keyboardWillHide') {
        keyboardWillHideCallback = callback as () => void;
      }
      return Promise.resolve({ remove: mockRemove });
    })
  }
}));

// Import after mocking
import { Keyboard } from '@capacitor/keyboard';
import { useKeyboardHeight } from './useKeyboardHeight';

describe('useKeyboardHeight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    keyboardWillShowCallback = null;
    keyboardWillHideCallback = null;
    mockRemove.mockClear();
    mockIsNativePlatform = true;
  });

  it('should return 0 initially', () => {
    const { result } = renderHook(() => useKeyboardHeight());
    expect(result.current).toBe(0);
  });

  it('should register keyboard listeners on mount when native', () => {
    renderHook(() => useKeyboardHeight());

    expect(Keyboard.addListener).toHaveBeenCalledTimes(2);
    expect(Keyboard.addListener).toHaveBeenCalledWith(
      'keyboardWillShow',
      expect.any(Function)
    );
    expect(Keyboard.addListener).toHaveBeenCalledWith(
      'keyboardWillHide',
      expect.any(Function)
    );
  });

  it('should not register listeners on web platform', () => {
    mockIsNativePlatform = false;
    renderHook(() => useKeyboardHeight());

    expect(Keyboard.addListener).not.toHaveBeenCalled();
  });

  it('should update height when keyboard shows', async () => {
    const { result } = renderHook(() => useKeyboardHeight());

    // Simulate keyboard appearing
    await act(async () => {
      keyboardWillShowCallback?.({ keyboardHeight: 300 });
    });

    expect(result.current).toBe(300);
  });

  it('should reset height to 0 when keyboard hides', async () => {
    const { result } = renderHook(() => useKeyboardHeight());

    // Simulate keyboard appearing
    await act(async () => {
      keyboardWillShowCallback?.({ keyboardHeight: 300 });
    });

    expect(result.current).toBe(300);

    // Simulate keyboard hiding
    await act(async () => {
      keyboardWillHideCallback?.();
    });

    expect(result.current).toBe(0);
  });

  it('should remove listeners on unmount', async () => {
    const { unmount } = renderHook(() => useKeyboardHeight());

    // Wait for listeners to be registered
    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    // Wait for cleanup
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRemove).toHaveBeenCalledTimes(2);
  });
});
