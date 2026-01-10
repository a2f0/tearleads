import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emitInstanceChange,
  getListenerCount,
  resetInstanceChangeState,
  subscribeToInstanceChange,
  useOnInstanceChange
} from './useInstanceChange';

describe('useInstanceChange', () => {
  beforeEach(() => {
    resetInstanceChangeState();
  });

  afterEach(() => {
    resetInstanceChangeState();
  });

  describe('subscribeToInstanceChange', () => {
    it('notifies subscribers when instance changes', () => {
      const callback = vi.fn();
      subscribeToInstanceChange(callback);

      emitInstanceChange('instance-1');
      expect(callback).toHaveBeenCalledWith('instance-1', null);

      emitInstanceChange('instance-2');
      expect(callback).toHaveBeenCalledWith('instance-2', 'instance-1');

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('does not notify after unsubscribe', () => {
      const callback = vi.fn();
      const unsubscribe = subscribeToInstanceChange(callback);
      unsubscribe();

      emitInstanceChange('instance-1');
      expect(callback).not.toHaveBeenCalled();
    });

    it('supports multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      subscribeToInstanceChange(callback1);
      subscribeToInstanceChange(callback2);

      emitInstanceChange('instance-1');

      expect(callback1).toHaveBeenCalledWith('instance-1', null);
      expect(callback2).toHaveBeenCalledWith('instance-1', null);
    });

    it('handles errors in callbacks gracefully', () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Test error');
      });
      const goodCallback = vi.fn();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
        // Suppress error output in tests
      });

      subscribeToInstanceChange(errorCallback);
      subscribeToInstanceChange(goodCallback);

      // Should not throw
      expect(() => emitInstanceChange('instance-1')).not.toThrow();

      // Both callbacks should have been called
      expect(errorCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('does not emit when instance ID is unchanged', () => {
      const callback = vi.fn();
      subscribeToInstanceChange(callback);

      emitInstanceChange('instance-1');
      expect(callback).toHaveBeenCalledTimes(1);

      // Emit same instance again
      emitInstanceChange('instance-1');
      expect(callback).toHaveBeenCalledTimes(1); // Should not be called again
    });
  });

  describe('useOnInstanceChange', () => {
    it('subscribes on mount and unsubscribes on unmount', () => {
      const callback = vi.fn();

      const { unmount } = renderHook(() => useOnInstanceChange(callback));

      expect(getListenerCount()).toBe(1);

      emitInstanceChange('instance-1');
      expect(callback).toHaveBeenCalledWith('instance-1', null);

      unmount();

      expect(getListenerCount()).toBe(0);

      // Should not be called after unmount
      emitInstanceChange('instance-2');
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('re-subscribes when callback changes', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const { rerender } = renderHook(
        ({ callback }) => useOnInstanceChange(callback),
        { initialProps: { callback: callback1 } }
      );

      emitInstanceChange('instance-1');
      expect(callback1).toHaveBeenCalledWith('instance-1', null);
      expect(callback2).not.toHaveBeenCalled();

      // Change callback
      rerender({ callback: callback2 });

      emitInstanceChange('instance-2');
      expect(callback2).toHaveBeenCalledWith('instance-2', 'instance-1');
    });
  });

  describe('getListenerCount', () => {
    it('returns the current number of listeners', () => {
      expect(getListenerCount()).toBe(0);

      const unsub1 = subscribeToInstanceChange(() => {
        // Empty callback
      });
      expect(getListenerCount()).toBe(1);

      const unsub2 = subscribeToInstanceChange(() => {
        // Empty callback
      });
      expect(getListenerCount()).toBe(2);

      unsub1();
      expect(getListenerCount()).toBe(1);

      unsub2();
      expect(getListenerCount()).toBe(0);
    });
  });

  describe('resetInstanceChangeState', () => {
    it('clears all listeners and resets last instance ID', () => {
      subscribeToInstanceChange(() => {
        // Empty callback
      });
      emitInstanceChange('instance-1');

      expect(getListenerCount()).toBe(1);

      resetInstanceChangeState();

      expect(getListenerCount()).toBe(0);

      // After reset, the next emit should have null as previous
      const callback = vi.fn();
      subscribeToInstanceChange(callback);
      emitInstanceChange('instance-2');

      expect(callback).toHaveBeenCalledWith('instance-2', null);
    });
  });
});
