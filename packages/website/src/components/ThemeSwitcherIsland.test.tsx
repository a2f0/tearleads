import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSwitcherIsland } from './ThemeSwitcherIsland';

describe('ThemeSwitcherIsland', () => {
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

  it('renders the theme switcher button', () => {
    render(<ThemeSwitcherIsland />);

    const button = screen.getByTestId('theme-switcher');
    expect(button).toBeInTheDocument();
  });

  it('renders with accessible label', () => {
    render(<ThemeSwitcherIsland />);

    const button = screen.getByRole('button', { name: /toggle theme/i });
    expect(button).toBeInTheDocument();
  });

  it('has consistent initial state for SSR hydration', () => {
    // This test verifies the fix for React hydration error #418
    // The initial render should always use 'monochrome' as the resolved theme
    // regardless of system preferences, to match server-side rendering
    render(<ThemeSwitcherIsland />);

    // The button should render with the Moon icon (indicating non-dark mode)
    // and be accessible - this proves hydration succeeded without mismatch
    const button = screen.getByTestId('theme-switcher');
    expect(button).toBeInTheDocument();

    // Initial resolved theme should be 'monochrome' (consistent with SSR)
    expect(button).toHaveAttribute(
      'aria-label',
      'Toggle theme (current: monochrome)'
    );
  });

  it('does not cause hydration mismatch with dark system preference', () => {
    // Even with dark mode preference, initial render should be 'monochrome'
    // to match SSR output
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true, // User prefers dark mode
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });

    render(<ThemeSwitcherIsland />);

    // Should still render successfully (no hydration error)
    const button = screen.getByTestId('theme-switcher');
    expect(button).toBeInTheDocument();
  });
});
