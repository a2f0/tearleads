import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopWindowLinkHandler } from './useDesktopWindowLinkHandler';

const mockOpenWindow = vi.fn();
const mockUseWindowManagerActions = vi.fn();
const mockUseIsMobile = vi.fn();

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => mockUseWindowManagerActions()
}));

vi.mock('@/hooks/device', () => ({
  useIsMobile: () => mockUseIsMobile()
}));

function HookHarness() {
  const onClick = useDesktopWindowLinkHandler('sync');
  return (
    <a href="/sync" onClick={onClick}>
      open sync
    </a>
  );
}

describe('useDesktopWindowLinkHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWindowManagerActions.mockReturnValue({ openWindow: mockOpenWindow });
    mockUseIsMobile.mockReturnValue(false);
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      value: 0,
      configurable: true
    });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });

  it('opens the target window on desktop', () => {
    render(<HookHarness />);
    fireEvent.click(screen.getByRole('link', { name: 'open sync' }));
    expect(mockOpenWindow).toHaveBeenCalledWith('sync');
  });

  it('does not open a window on mobile screens', () => {
    mockUseIsMobile.mockReturnValue(true);
    render(<HookHarness />);
    fireEvent.click(screen.getByRole('link', { name: 'open sync' }));
    expect(mockOpenWindow).not.toHaveBeenCalled();
  });

  it('does not open a window on coarse pointer devices', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(pointer: coarse)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });

    render(<HookHarness />);
    fireEvent.click(screen.getByRole('link', { name: 'open sync' }));
    expect(mockOpenWindow).not.toHaveBeenCalled();
  });
});
