import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSelector } from './ThemeSelector';

describe('ThemeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove(
      'light',
      'dark',
      'tokyo-night',
      'monochrome'
    );

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
    defaultTheme:
      | 'light'
      | 'dark'
      | 'tokyo-night'
      | 'monochrome'
      | 'system' = 'light'
  ) {
    return render(
      <ThemeProvider defaultTheme={defaultTheme}>
        <ThemeSelector />
      </ThemeProvider>
    );
  }

  it('renders all four theme options', () => {
    renderThemeSelector();
    expect(screen.getByTestId('theme-option-light')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-dark')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-tokyo-night')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-monochrome')).toBeInTheDocument();
  });

  it('shows current theme as selected', () => {
    renderThemeSelector('dark');
    const darkOption = screen.getByTestId('theme-option-dark');
    expect(darkOption).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows resolved theme as selected when theme is system', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    });
    renderThemeSelector('system');
    const darkOption = screen.getByTestId('theme-option-dark');
    expect(darkOption).toHaveAttribute('aria-pressed', 'true');
  });

  it('changes theme when option is clicked', async () => {
    const user = userEvent.setup();
    renderThemeSelector('light');

    await user.click(screen.getByTestId('theme-option-tokyo-night'));

    expect(document.documentElement.classList.contains('tokyo-night')).toBe(
      true
    );
  });

  it('uses flex layout with horizontal scroll on mobile', () => {
    renderThemeSelector();
    const container = screen.getByTestId('theme-selector-container');
    expect(container.className).toContain('flex');
    expect(container.className).toContain('overflow-x-auto');
    expect(container.className).toContain('md:overflow-visible');
    expect(container.className).not.toContain('flex-wrap');
  });

  it('applies responsive widths and prevents shrinking on theme options', () => {
    renderThemeSelector();
    const themeOption = screen.getByTestId('theme-option-light');
    expect(themeOption.className).toContain('w-[100px]');
    expect(themeOption.className).toContain('shrink-0');
    expect(themeOption.className).toContain('md:w-[200px]');
  });

  it('renders theme labels', () => {
    renderThemeSelector();
    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
    expect(screen.getByText('Tokyo Night')).toBeInTheDocument();
    expect(screen.getByText('Monochrome')).toBeInTheDocument();
  });
});
