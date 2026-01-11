import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsButton } from './SettingsButton';

describe('SettingsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove('light', 'dark', 'tokyo-night');

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn()
      },
      writable: true
    });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
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

  it('opens settings sheet when clicked', async () => {
    const user = userEvent.setup();
    renderSettingsButton();

    expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('settings-button'));

    expect(screen.getByTestId('settings-sheet')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
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
      { timeout: 500 }
    );
  });

  it('closes settings sheet when Escape pressed', async () => {
    const user = userEvent.setup();
    renderSettingsButton();

    await user.click(screen.getByTestId('settings-button'));
    expect(screen.getByTestId('settings-sheet')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(
      () => {
        expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();
      },
      { timeout: 500 }
    );
  });
});
