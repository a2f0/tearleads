import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../context/themeProvider';
import { ThemeSwitcher } from './themeSwitcher';

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset document classes
    document.documentElement.classList.remove('light', 'dark', 'tokyo-night');

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn()
      },
      writable: true
    });

    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });

  function renderThemeSwitcher(
    props?: Partial<React.ComponentProps<typeof ThemeSwitcher>>
  ) {
    return render(
      <ThemeProvider defaultTheme="light">
        <ThemeSwitcher {...props} />
      </ThemeProvider>
    );
  }

  describe('rendering', () => {
    it('renders the theme switcher button', () => {
      renderThemeSwitcher();

      expect(screen.getByTestId('theme-switcher')).toBeInTheDocument();
    });

    it('has correct aria-label', () => {
      renderThemeSwitcher();

      expect(screen.getByLabelText(/toggle theme/i)).toBeInTheDocument();
    });

    it('shows current theme in aria-label', () => {
      renderThemeSwitcher();

      expect(screen.getByLabelText(/current: light/i)).toBeInTheDocument();
    });
  });

  describe('size variants', () => {
    it('renders with default size', () => {
      renderThemeSwitcher();

      const button = screen.getByTestId('theme-switcher');
      expect(button.className).toContain('h-9 w-9');
    });

    it('renders with sm size', () => {
      renderThemeSwitcher({ size: 'sm' });

      const button = screen.getByTestId('theme-switcher');
      expect(button.className).toContain('h-8 w-8');
    });

    it('renders with lg size', () => {
      renderThemeSwitcher({ size: 'lg' });

      const button = screen.getByTestId('theme-switcher');
      expect(button.className).toContain('h-10 w-10');
    });
  });

  describe('className prop', () => {
    it('applies custom className', () => {
      renderThemeSwitcher({ className: 'custom-class' });

      const button = screen.getByTestId('theme-switcher');
      expect(button.className).toContain('custom-class');
    });
  });

  describe('toggle behavior without system option', () => {
    it('toggles from light to dark', async () => {
      const user = userEvent.setup();

      render(
        <ThemeProvider defaultTheme="light">
          <ThemeSwitcher />
        </ThemeProvider>
      );

      await user.click(screen.getByTestId('theme-switcher'));

      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('toggles from dark to light', async () => {
      const user = userEvent.setup();

      render(
        <ThemeProvider defaultTheme="dark">
          <ThemeSwitcher />
        </ThemeProvider>
      );

      await user.click(screen.getByTestId('theme-switcher'));

      expect(document.documentElement.classList.contains('light')).toBe(true);
    });
  });

  describe('toggle behavior with system option', () => {
    it('cycles light -> dark -> tokyo-night -> system -> light', async () => {
      const user = userEvent.setup();

      render(
        <ThemeProvider defaultTheme="light">
          <ThemeSwitcher showSystemOption />
        </ThemeProvider>
      );

      const button = screen.getByTestId('theme-switcher');

      // Light -> Dark
      await user.click(button);
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      // Dark -> Tokyo Night
      await user.click(button);
      expect(document.documentElement.classList.contains('tokyo-night')).toBe(
        true
      );

      // Tokyo Night -> System (which resolves to light in our mock)
      await user.click(button);
      expect(document.documentElement.classList.contains('light')).toBe(true);

      // System -> Light
      await user.click(button);
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });
  });

  describe('icon display', () => {
    it('shows Moon icon in light mode', () => {
      render(
        <ThemeProvider defaultTheme="light">
          <ThemeSwitcher />
        </ThemeProvider>
      );

      const button = screen.getByTestId('theme-switcher');
      // Check for Moon icon (lucide-react renders SVG with class)
      const svg = button.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg?.classList.contains('lucide-moon')).toBe(true);
    });

    it('shows Sun icon in dark mode', () => {
      render(
        <ThemeProvider defaultTheme="dark">
          <ThemeSwitcher />
        </ThemeProvider>
      );

      const button = screen.getByTestId('theme-switcher');
      const svg = button.querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg?.classList.contains('lucide-sun')).toBe(true);
    });
  });
});
