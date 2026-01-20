import { ThemeProvider } from '@rapid/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowManager } from '@/contexts/WindowManagerContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { setupThemeMocks } from '@/test/theme-test-utils';
import { SettingsButton } from './SettingsButton';
import { ANIMATION_DURATION_MS } from './ui/bottom-sheet';

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: vi.fn()
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn()
}));

describe('SettingsButton', () => {
  const openWindow = vi.fn();
  const focusWindow = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    setupThemeMocks();
    vi.mocked(useWindowManager).mockReturnValue({
      windows: [],
      openWindow,
      focusWindow,
      closeWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      restoreWindow: vi.fn(),
      updateWindowDimensions: vi.fn(),
      saveWindowDimensionsForType: vi.fn(),
      isWindowOpen: vi.fn(),
      getWindow: vi.fn()
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

  it('focuses existing settings window on desktop', async () => {
    const user = userEvent.setup();
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useWindowManager).mockReturnValue({
      windows: [
        { id: 'settings-1', type: 'settings', zIndex: 1, isMinimized: false }
      ],
      openWindow,
      focusWindow,
      closeWindow: vi.fn(),
      minimizeWindow: vi.fn(),
      restoreWindow: vi.fn(),
      updateWindowDimensions: vi.fn(),
      saveWindowDimensionsForType: vi.fn(),
      isWindowOpen: vi.fn(),
      getWindow: vi.fn()
    });
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));

    expect(focusWindow).toHaveBeenCalledWith('settings-1');
    expect(openWindow).not.toHaveBeenCalled();
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
