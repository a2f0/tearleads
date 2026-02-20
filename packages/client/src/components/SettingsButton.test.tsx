import { ThemeProvider } from '@tearleads/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowManagerActions } from '@/contexts/WindowManagerContext';
import { useIsMobile } from '@/hooks/device';
import { setupThemeMocks } from '@/test/themeTestUtils';
import { SettingsButton } from './SettingsButton';
import { ANIMATION_DURATION_MS } from './ui/bottom-sheet';

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: vi.fn()
}));

vi.mock('@/hooks/device', () => ({
  useIsMobile: vi.fn()
}));

describe('SettingsButton', () => {
  const openWindow = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    setupThemeMocks();
    vi.mocked(useWindowManagerActions).mockReturnValue({
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
      <ThemeProvider defaultTheme="light">
        <SettingsButton />
      </ThemeProvider>
    );
  }

  it('renders settings icon button', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    renderSettingsButton();
    expect(screen.getByTestId('settings-button')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
  });

  it('opens settings window on desktop when clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(useIsMobile).mockReturnValue(false);
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));

    expect(openWindow).toHaveBeenCalledWith('settings');
    expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();
  });

  it('calls openWindow on desktop (openWindow handles existing windows)', async () => {
    const user = userEvent.setup();
    vi.mocked(useIsMobile).mockReturnValue(false);
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));

    // openWindow internally handles focusing existing windows of the same type
    expect(openWindow).toHaveBeenCalledWith('settings');
  });

  it('opens settings sheet on mobile when clicked once', async () => {
    const user = userEvent.setup();
    vi.mocked(useIsMobile).mockReturnValue(true);
    renderSettingsButton();

    expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('settings-button'));

    expect(screen.getByTestId('settings-sheet')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('closes settings sheet when backdrop clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(useIsMobile).mockReturnValue(true);
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));
    expect(screen.getByTestId('settings-sheet')).toBeInTheDocument();

    await user.click(screen.getByTestId('settings-sheet-backdrop'));

    await waitFor(
      () => {
        expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();
      },
      { timeout: ANIMATION_DURATION_MS + 500 }
    );
  });

  it('closes settings sheet when Escape pressed', async () => {
    const user = userEvent.setup();
    vi.mocked(useIsMobile).mockReturnValue(true);
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));
    expect(screen.getByTestId('settings-sheet')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(
      () => {
        expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();
      },
      { timeout: ANIMATION_DURATION_MS + 500 }
    );
  });
});
