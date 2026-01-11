import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsSheet } from './SettingsSheet';

describe('SettingsSheet', () => {
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

  function renderSettingsSheet(open: boolean, onOpenChange = vi.fn()) {
    return render(
      <ThemeProvider defaultTheme="light">
        <SettingsSheet open={open} onOpenChange={onOpenChange} />
      </ThemeProvider>
    );
  }

  it('renders nothing when not open', () => {
    renderSettingsSheet(false);
    expect(screen.queryByTestId('settings-sheet')).not.toBeInTheDocument();
  });

  it('renders with Settings title when open', () => {
    renderSettingsSheet(true);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders ThemeSelector inside the sheet', () => {
    renderSettingsSheet(true);
    expect(screen.getByTestId('theme-selector-container')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-light')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-dark')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-tokyo-night')).toBeInTheDocument();
  });

  it('passes onOpenChange to BottomSheet', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    renderSettingsSheet(true, onOpenChange);

    await user.click(screen.getByTestId('settings-sheet-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('allows theme selection', async () => {
    const user = userEvent.setup();
    renderSettingsSheet(true);

    await user.click(screen.getByTestId('theme-option-dark'));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
