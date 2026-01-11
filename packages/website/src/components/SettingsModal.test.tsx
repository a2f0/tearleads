import { ThemeProvider } from '@rapid/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';

const renderWithProvider = (ui: React.ReactNode) => {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
};

describe('SettingsModal', () => {
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
  it('renders when open is true', () => {
    renderWithProvider(<SettingsModal open={true} onOpenChange={() => {}} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    renderWithProvider(<SettingsModal open={false} onOpenChange={() => {}} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders theme selector', () => {
    renderWithProvider(<SettingsModal open={true} onOpenChange={() => {}} />);

    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByTestId('theme-selector-container')).toBeInTheDocument();
  });

  it('calls onOpenChange when closed', () => {
    const onOpenChange = vi.fn();
    renderWithProvider(
      <SettingsModal open={true} onOpenChange={onOpenChange} />
    );

    fireEvent.click(screen.getByTestId('settings-modal-backdrop'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
