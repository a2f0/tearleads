import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayPropertiesWindow } from './DisplayPropertiesWindow';

vi.mock('@tearleads/settings', () => ({
  FontSelector: () => <div data-testid="font-selector">FontSelector</div>,
  BorderRadiusToggle: () => (
    <div data-testid="border-radius-toggle">BorderRadiusToggle</div>
  ),
  IconBackgroundToggle: () => (
    <div data-testid="icon-background">IconBackgroundToggle</div>
  ),
  IconDepthToggle: () => <div data-testid="icon-depth">IconDepthToggle</div>,
  PatternSelector: () => (
    <div data-testid="pattern-selector">PatternSelector</div>
  ),
  ThemeSelector: () => <div data-testid="theme-selector">ThemeSelector</div>
}));

vi.mock('@/components/screensaver', () => ({
  ScreensaverButton: () => (
    <div data-testid="screensaver-button">ScreensaverButton</div>
  )
}));

describe('DisplayPropertiesWindow', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024
    });
    Object.defineProperty(window, 'innerHeight', {
      writable: true,
      configurable: true,
      value: 768
    });
  });

  function renderWindow(props = {}) {
    return render(
      <ThemeProvider defaultTheme="light">
        <DisplayPropertiesWindow {...defaultProps} {...props} />
      </ThemeProvider>
    );
  }

  it('renders when open is true', () => {
    renderWindow();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Display Properties')).toBeInTheDocument();
  });

  it('returns null when open is false', () => {
    renderWindow({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders all selectors', () => {
    renderWindow();
    expect(screen.getByTestId('theme-selector')).toBeInTheDocument();
    expect(screen.getByTestId('pattern-selector')).toBeInTheDocument();
    expect(screen.getByTestId('icon-depth')).toBeInTheDocument();
    expect(screen.getByTestId('icon-background')).toBeInTheDocument();
    expect(screen.getByTestId('font-selector')).toBeInTheDocument();
    expect(screen.getByTestId('border-radius-toggle')).toBeInTheDocument();
  });

  it('calls onOpenChange with false when close button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWindow({ onOpenChange });

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange with false from File menu Close', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWindow({ onOpenChange });

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
