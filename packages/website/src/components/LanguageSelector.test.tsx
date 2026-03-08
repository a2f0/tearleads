import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as navigation from '../utils/navigation';
import { LanguageSelector } from './LanguageSelector';

describe('LanguageSelector', () => {
  let navigateToPathSpy: ReturnType<typeof vi.spyOn> | null = null;
  const originalGlobalLocalStorage = globalThis.localStorage;
  const originalWindowLocalStorage = window.localStorage;
  const localStorageMock = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/en/docs/api');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: localStorageMock
    });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: localStorageMock
    });
    navigateToPathSpy = vi
      .spyOn(navigation, 'navigateToPath')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: originalGlobalLocalStorage
    });
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      writable: true,
      value: originalWindowLocalStorage
    });
    navigateToPathSpy?.mockRestore();
    navigateToPathSpy = null;
  });

  it('renders all language options', () => {
    render(<LanguageSelector currentLang="en" />);

    expect(
      screen.getByTestId('language-selector-container')
    ).toBeInTheDocument();
    expect(screen.getByTestId('language-option-en')).toBeInTheDocument();
    expect(screen.getByTestId('language-option-es')).toBeInTheDocument();
    expect(screen.getByTestId('language-option-ua')).toBeInTheDocument();
    expect(screen.getByTestId('language-option-pt')).toBeInTheDocument();
  });

  it('displays language names and flags', () => {
    render(<LanguageSelector currentLang="en" />);

    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Español')).toBeInTheDocument();
    expect(screen.getByText('Українська')).toBeInTheDocument();
    expect(screen.getByText('Português')).toBeInTheDocument();
    expect(screen.getByText('🇺🇸')).toBeInTheDocument();
    expect(screen.getByText('🇪🇸')).toBeInTheDocument();
    expect(screen.getByText('🇺🇦')).toBeInTheDocument();
    expect(screen.getByText('🇵🇹')).toBeInTheDocument();
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

    if (navigateToPathSpy === null) {
      throw new Error('Expected spies to be initialized');
    }
    expect(localStorageMock.setItem).toHaveBeenCalledWith('language', 'es');
    expect(navigateToPathSpy).toHaveBeenCalledTimes(1);
    expect(navigateToPathSpy.mock.calls[0]?.[0]).toBe('/es/docs/api');
  });
});
