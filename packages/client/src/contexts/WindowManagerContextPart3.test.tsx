import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOBILE_BREAKPOINT } from '@/constants/breakpoints';
import {
  clearPreserveWindowState,
  setPreserveWindowState
} from '@/lib/windowStatePreference';
import {
  useWindowManager,
  useWindowOpenRequest,
  WindowManagerProvider
} from './WindowManagerContext';describe('WindowManagerContext', () => {

  function wrapper({ children }: { children: ReactNode }) {
    return <WindowManagerProvider>{children}</WindowManagerProvider>;
  }

  beforeEach(() => {
    localStorage.clear();
    clearPreserveWindowState();
    Object.defineProperty(window, 'innerWidth', {
      value: 1440,
      configurable: true
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 900,
      configurable: true
    });
  });

  describe('useWindowOpenRequest', () => {
    it('throws error when used outside WindowManagerProvider', () => {
      expect(() => {
        renderHook(() => useWindowOpenRequest('files'));
      }).toThrow(
        'useWindowOpenRequest must be used within a WindowManagerProvider'
      );
    });

    it('returns undefined when no request exists for type', () => {
      const { result } = renderHook(() => useWindowOpenRequest('files'), {
        wrapper
      });
      expect(result.current).toBeUndefined();
    });

    it('returns request when one exists for type', () => {
      const { result } = renderHook(
        () => ({
          manager: useWindowManager(),
          request: useWindowOpenRequest('files')
        }),
        { wrapper }
      );

      act(() => {
        result.current.manager.requestWindowOpen('files', {
          fileId: 'test-123'
        });
      });

      expect(result.current.request).toMatchObject({
        fileId: 'test-123',
        requestId: expect.any(Number)
      });
    });
  });
});
