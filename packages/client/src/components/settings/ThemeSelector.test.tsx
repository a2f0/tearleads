import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSelector } from './ThemeSelector';

describe('ThemeSelector', () => {
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

  function renderThemeSelector(
    defaultTheme: 'light' | 'dark' | 'tokyo-night' = 'light'
  ) {
    return render(
      <ThemeProvider defaultTheme={defaultTheme}>
        <ThemeSelector />
      </ThemeProvider>
    );
  }

  it('renders all three theme options', () => {
    renderThemeSelector();
    expect(screen.getByTestId('theme-option-light')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-dark')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-tokyo-night')).toBeInTheDocument();
  });

  it('shows current theme as selected', () => {
    renderThemeSelector('dark');
    const darkOption = screen.getByTestId('theme-option-dark');
    expect(darkOption.className).toContain('ring-2');
  });

  it('changes theme when option is clicked', async () => {
    const user = userEvent.setup();
    renderThemeSelector('light');

    await user.click(screen.getByTestId('theme-option-tokyo-night'));

    expect(document.documentElement.classList.contains('tokyo-night')).toBe(
      true
    );
  });

  it('uses 3-column grid layout', () => {
    renderThemeSelector();
    const grid = screen.getByTestId('theme-selector-grid');
    expect(grid.className).toContain('grid-cols-3');
  });

  it('renders theme labels', () => {
    renderThemeSelector();
    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
    expect(screen.getByText('Tokyo Night')).toBeInTheDocument();
  });
});
