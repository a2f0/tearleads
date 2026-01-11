import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsIsland } from './SettingsIsland';

describe('SettingsIsland', () => {
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
  it('renders settings button', () => {
    render(<SettingsIsland />);

    expect(screen.getByTestId('settings-button')).toBeInTheDocument();
  });

  it('provides theme context to children', () => {
    render(<SettingsIsland />);

    fireEvent.click(screen.getByTestId('settings-button'));

    expect(screen.getByTestId('theme-selector-container')).toBeInTheDocument();
  });
});
