import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageSelector } from './LanguageSelector';

describe('LanguageSelector', () => {
  const mockLocation = {
    pathname: '/en/docs/api',
    href: 'http://localhost/en/docs/api'
  };

  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn()
      },
      writable: true
    });

    Object.defineProperty(window, 'location', {
      value: mockLocation,
      writable: true
    });
  });

  it('renders all language options', () => {
    render(<LanguageSelector currentLang="en" />);

    expect(
      screen.getByTestId('language-selector-container')
    ).toBeInTheDocument();
    expect(screen.getByTestId('language-option-en')).toBeInTheDocument();
    expect(screen.getByTestId('language-option-es')).toBeInTheDocument();
    expect(screen.getByTestId('language-option-ua')).toBeInTheDocument();
  });

  it('displays language names and flags', () => {
    render(<LanguageSelector currentLang="en" />);

    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Español')).toBeInTheDocument();
    expect(screen.getByText('Українська')).toBeInTheDocument();
    expect(screen.getByText('🇺🇸')).toBeInTheDocument();
    expect(screen.getByText('🇪🇸')).toBeInTheDocument();
    expect(screen.getByText('🇺🇦')).toBeInTheDocument();
  });

  it('marks current language as selected', () => {
    render(<LanguageSelector currentLang="es" />);

    expect(screen.getByTestId('language-option-es')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('language-option-en')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('saves language to localStorage and navigates on click', () => {
    render(<LanguageSelector currentLang="en" />);

    fireEvent.click(screen.getByTestId('language-option-es'));

    expect(window.localStorage.setItem).toHaveBeenCalledWith('language', 'es');
    expect(window.location.href).toBe('/es/docs/api');
  });
});
