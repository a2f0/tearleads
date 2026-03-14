import { SettingsProvider } from '@tearleads/app-settings';
import { ThemeProvider } from '@tearleads/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowManagerActions } from '@/contexts/WindowManagerContext';
import { useIsMobile } from '@/hooks/device';
import { setupThemeMocks } from '@/test/themeTestUtils';
import { SettingsButton } from './SettingsButton';

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: vi.fn()
}));

vi.mock('@/hooks/device', () => ({
  useIsMobile: vi.fn()
}));

vi.mock('./settings/SettingsSheet', () => {
  return {
    SettingsSheet: ({
      open,
      onOpenChange
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) => {
      if (!open) {
        return null;
      }

      return createElement(
        'div',
        {
          role: 'dialog',
          tabIndex: -1,
          'data-testid': 'settings-sheet',
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              onOpenChange(false);
            }
          }
        },
        createElement(
          'button',
          {
            type: 'button',
            'data-testid': 'settings-sheet-backdrop',
            onClick: () => onOpenChange(false)
          },
          'Backdrop'
        ),
        createElement('div', null, 'Settings')
      );
    }
  };
});

describe('SettingsButton', () => {
  const openWindow = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    setupThemeMocks();
    useWindowManagerActions.mockReturnValue({
      openWindow,
      requestWindowOpen: vi.fn(),
      focusWindow: vi.fn(),
      closeWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      restoreWindow: vi.fn(),
      updateWindowDimensions: vi.fn(),
      saveWindowDimensionsForType: vi.fn(),
      renameWindow: vi.fn()
    });
  });

  function renderSettingsButton() {
    return render(
      createElement(
        ThemeProvider,
        { defaultTheme: 'light' },
        createElement(SettingsProvider, null, createElement(SettingsButton))
      )
    );
  }

  it('renders settings icon button', () => {
    useIsMobile.mockReturnValue(false);
    renderSettingsButton();
    expect(screen.getByTestId('settings-button')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
  });

  it('opens settings window on desktop when clicked', async () => {
    const user = userEvent.setup();
    useIsMobile.mockReturnValue(false);
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));

    expect(openWindow).toHaveBeenCalledWith('settings');
    expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();
  });

  it('calls openWindow on desktop (openWindow handles existing windows)', async () => {
    const user = userEvent.setup();
    useIsMobile.mockReturnValue(false);
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));

    // openWindow internally handles focusing existing windows of the same type
    expect(openWindow).toHaveBeenCalledWith('settings');
  });

  it('opens settings sheet on mobile when clicked once', async () => {
    const user = userEvent.setup();
    useIsMobile.mockReturnValue(true);
    renderSettingsButton();

    expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('settings-button'));

    expect(screen.getByTestId('settings-sheet')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('closes settings sheet when backdrop clicked', async () => {
    const user = userEvent.setup();
    useIsMobile.mockReturnValue(true);
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));
    expect(screen.getByTestId('settings-sheet')).toBeInTheDocument();

    await user.click(screen.getByTestId('settings-sheet-backdrop'));

    await waitFor(() => {
      expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();
    });
  });

  it('closes settings sheet when Escape pressed', async () => {
    const user = userEvent.setup();
    useIsMobile.mockReturnValue(true);
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));
    expect(screen.getByTestId('settings-sheet')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('settings-sheet'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();
    });
  });
});
