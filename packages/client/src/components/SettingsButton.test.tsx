import { ThemeProvider } from '@rapid/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupThemeMocks } from '@/test/theme-test-utils';
import { SettingsButton } from './SettingsButton';
import { ANIMATION_DURATION_MS } from './ui/bottom-sheet';

const mockFocusWindow = vi.hoisted(() => vi.fn());
const mockOpenWindow = vi.hoisted(() => vi.fn());
const mockUseWindowManager = vi.hoisted(() => vi.fn());
const mockUseIsMobile = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManager: () => mockUseWindowManager()
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => mockUseIsMobile()
}));

describe('SettingsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    setupThemeMocks();
    mockUseIsMobile.mockReturnValue(true);
    mockUseWindowManager.mockReturnValue({
      focusWindow: mockFocusWindow,
      openWindow: mockOpenWindow,
      windows: []
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
    renderSettingsButton();
    expect(screen.getByTestId('settings-button')).toBeInTheDocument();
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
  });

  it('opens settings sheet when clicked on mobile', async () => {
    const user = userEvent.setup();
    renderSettingsButton();

    expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('settings-button'));

    expect(screen.getByTestId('settings-sheet')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('launches settings window when clicked on desktop', async () => {
    const user = userEvent.setup();
    mockUseIsMobile.mockReturnValue(false);
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));

    expect(mockOpenWindow).toHaveBeenCalledWith('settings');
    expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();
  });

  it('focuses existing settings window on desktop', async () => {
    const user = userEvent.setup();
    mockUseIsMobile.mockReturnValue(false);
    mockUseWindowManager.mockReturnValue({
      focusWindow: mockFocusWindow,
      openWindow: mockOpenWindow,
      windows: [
        { id: 'settings-1', type: 'settings', zIndex: 1, isMinimized: false }
      ]
    });
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));

    expect(mockFocusWindow).toHaveBeenCalledWith('settings-1');
    expect(mockOpenWindow).not.toHaveBeenCalled();
  });

  it('closes settings sheet when backdrop clicked', async () => {
    const user = userEvent.setup();
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
