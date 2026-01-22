import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ScreensaverProvider, useScreensaver } from './ScreensaverContext';

describe('ScreensaverContext', () => {
  describe('useScreensaver', () => {
    it('throws error when used outside provider', () => {
      expect(() => renderHook(() => useScreensaver())).toThrow(
        'useScreensaver must be used within a ScreensaverProvider'
      );
    });

    it('provides isActive state defaulting to false', () => {
      const { result } = renderHook(() => useScreensaver(), {
        wrapper: ScreensaverProvider
      });
      expect(result.current.isActive).toBe(false);
    });

    it('activates screensaver', () => {
      const { result } = renderHook(() => useScreensaver(), {
        wrapper: ScreensaverProvider
      });

      act(() => {
        result.current.activate();
      });

      expect(result.current.isActive).toBe(true);
    });

    it('deactivates screensaver', () => {
      const { result } = renderHook(() => useScreensaver(), {
        wrapper: ScreensaverProvider
      });

      act(() => {
        result.current.activate();
      });
      expect(result.current.isActive).toBe(true);

      act(() => {
        result.current.deactivate();
      });
      expect(result.current.isActive).toBe(false);
    });
  });

  describe('keyboard shortcut', () => {
    it('activates on Ctrl+L', async () => {
      const user = userEvent.setup();
      function TestComponent() {
        const { isActive } = useScreensaver();
        return (
          <div data-testid="status">{isActive ? 'active' : 'inactive'}</div>
        );
      }

      render(
        <ScreensaverProvider>
          <TestComponent />
        </ScreensaverProvider>
      );

      expect(screen.getByTestId('status')).toHaveTextContent('inactive');

      await user.keyboard('{Control>}l{/Control}');

      expect(screen.getByTestId('status')).toHaveTextContent('active');
    });

    it('activates on Meta+L (Mac)', async () => {
      const user = userEvent.setup();
      function TestComponent() {
        const { isActive } = useScreensaver();
        return (
          <div data-testid="status">{isActive ? 'active' : 'inactive'}</div>
        );
      }

      render(
        <ScreensaverProvider>
          <TestComponent />
        </ScreensaverProvider>
      );

      expect(screen.getByTestId('status')).toHaveTextContent('inactive');

      await user.keyboard('{Meta>}l{/Meta}');

      expect(screen.getByTestId('status')).toHaveTextContent('active');
    });

    it('does not activate on L without modifier', async () => {
      const user = userEvent.setup();
      function TestComponent() {
        const { isActive } = useScreensaver();
        return (
          <div data-testid="status">{isActive ? 'active' : 'inactive'}</div>
        );
      }

      render(
        <ScreensaverProvider>
          <TestComponent />
        </ScreensaverProvider>
      );

      await user.keyboard('l');

      expect(screen.getByTestId('status')).toHaveTextContent('inactive');
    });
  });

  describe('cleanup', () => {
    it('removes event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const { unmount } = render(
        <ScreensaverProvider>
          <div>test</div>
        </ScreensaverProvider>
      );

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );

      removeEventListenerSpy.mockRestore();
    });
  });
});
