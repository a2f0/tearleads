import { ThemeProvider } from '@rapid/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeSelector } from './ThemeSelector';

const renderWithProvider = (ui: React.ReactNode) => {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
};

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
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });
  it('renders all three theme options', () => {
    renderWithProvider(<ThemeSelector />);

    expect(screen.getByTestId('theme-option-light')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-dark')).toBeInTheDocument();
    expect(screen.getByTestId('theme-option-tokyo-night')).toBeInTheDocument();
  });

  it('renders header text', () => {
    renderWithProvider(<ThemeSelector />);

    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(
      screen.getByText('Choose your preferred color theme')
    ).toBeInTheDocument();
  });

  it('renders theme preview labels', () => {
    renderWithProvider(<ThemeSelector />);

    expect(screen.getByText('Light')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
    expect(screen.getByText('Tokyo Night')).toBeInTheDocument();
  });

  it('changes theme when option is clicked', () => {
    renderWithProvider(<ThemeSelector />);

    const darkOption = screen.getByTestId('theme-option-dark');
    fireEvent.click(darkOption);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('highlights selected theme', () => {
    renderWithProvider(<ThemeSelector />);

    const lightOption = screen.getByTestId('theme-option-light');
    fireEvent.click(lightOption);

    expect(lightOption.className).toContain('border-primary');
  });
});
