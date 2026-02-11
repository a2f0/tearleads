import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutDialog } from './AboutDialog';

function renderDialog(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  version?: string;
  appName?: string;
  closeLabel?: string;
}) {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    version: '1.0.0'
  };

  return render(
    <ThemeProvider>
      <AboutDialog {...defaultProps} {...props} />
    </ThemeProvider>
  );
}

describe('AboutDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId('about-dialog')).not.toBeInTheDocument();
  });

  it('renders dialog when open', () => {
    renderDialog({ open: true });
    expect(screen.getByTestId('about-dialog')).toBeInTheDocument();
  });

  it('displays title and version', () => {
    renderDialog({ version: '2.0.0' });
    expect(screen.getByText('About Notes')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('2.0.0');
  });

  it('displays custom app name', () => {
    renderDialog({ appName: 'VFS Explorer' });
    expect(screen.getByText('About VFS Explorer')).toBeInTheDocument();
  });

  it('uses a custom close label when provided', () => {
    renderDialog({ closeLabel: 'Close' });
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('closes when OK is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.click(screen.getByTestId('about-ok'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes when backdrop is clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.click(screen.getByTestId('about-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes when escape key is pressed', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('traps focus within the dialog', async () => {
    const user = userEvent.setup();
    renderDialog({});

    const okButton = screen.getByTestId('about-ok');

    // Focus the OK button
    okButton.focus();
    expect(document.activeElement).toBe(okButton);

    // Tab should wrap back to first element (only one focusable element)
    await user.tab();
    expect(document.activeElement).toBe(okButton);
  });

  it('traps focus in reverse with shift+tab', async () => {
    const user = userEvent.setup();
    renderDialog({});

    const okButton = screen.getByTestId('about-ok');

    // Focus the OK button
    okButton.focus();
    expect(document.activeElement).toBe(okButton);

    // Shift+Tab should wrap to last element (only one focusable element)
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(okButton);
  });
});
