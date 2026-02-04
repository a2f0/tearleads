import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowOptionsDialog } from './WindowOptionsDialog';

function renderDialog(props: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  preserveWindowState?: boolean;
  onSave?: (preserveWindowState: boolean) => void;
  onFitContent?: () => void;
}) {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    preserveWindowState: true,
    onSave: vi.fn()
  };

  return render(
    <ThemeProvider>
      <WindowOptionsDialog {...defaultProps} {...props} />
    </ThemeProvider>
  );
}

describe('WindowOptionsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(
      screen.queryByTestId('window-options-dialog')
    ).not.toBeInTheDocument();
  });

  it('renders dialog when open', () => {
    renderDialog({ open: true });
    expect(screen.getByTestId('window-options-dialog')).toBeInTheDocument();
  });

  it('displays title and radio options', () => {
    renderDialog({});
    expect(screen.getByText('Window Options')).toBeInTheDocument();
    expect(screen.getByText('Preserve window state')).toBeInTheDocument();
    expect(screen.getByText('Use default window state')).toBeInTheDocument();
    expect(screen.getByText('Size window to content')).toBeInTheDocument();
  });

  it('shows preserve option selected when preserveWindowState is true', () => {
    renderDialog({ preserveWindowState: true });
    const preserveRadio = screen.getByTestId('window-state-preserve-radio');
    const defaultRadio = screen.getByTestId('window-state-default-radio');
    expect(preserveRadio).toBeChecked();
    expect(defaultRadio).not.toBeChecked();
  });

  it('shows default option selected when preserveWindowState is false', () => {
    renderDialog({ preserveWindowState: false });
    const preserveRadio = screen.getByTestId('window-state-preserve-radio');
    const defaultRadio = screen.getByTestId('window-state-default-radio');
    expect(preserveRadio).not.toBeChecked();
    expect(defaultRadio).toBeChecked();
  });

  it('allows changing selection to default', async () => {
    const user = userEvent.setup();
    renderDialog({ preserveWindowState: true });

    const defaultRadio = screen.getByTestId('window-state-default-radio');
    await user.click(defaultRadio);

    expect(defaultRadio).toBeChecked();
    expect(screen.getByTestId('window-state-preserve-radio')).not.toBeChecked();
  });

  it('allows changing selection to preserve', async () => {
    const user = userEvent.setup();
    renderDialog({ preserveWindowState: false });

    const preserveRadio = screen.getByTestId('window-state-preserve-radio');
    await user.click(preserveRadio);

    expect(preserveRadio).toBeChecked();
    expect(screen.getByTestId('window-state-default-radio')).not.toBeChecked();
  });

  it('calls onSave with true and closes when OK is clicked with preserve selected', async () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ preserveWindowState: true, onSave, onOpenChange });

    await user.click(screen.getByTestId('window-options-ok'));

    expect(onSave).toHaveBeenCalledWith(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onSave with false and closes when OK is clicked with default selected', async () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ preserveWindowState: true, onSave, onOpenChange });

    // Change to default option
    await user.click(screen.getByTestId('window-state-default-radio'));
    await user.click(screen.getByTestId('window-options-ok'));

    expect(onSave).toHaveBeenCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes without saving when cancel is clicked', async () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ preserveWindowState: true, onSave, onOpenChange });

    // Change selection but then cancel
    await user.click(screen.getByTestId('window-state-default-radio'));
    await user.click(screen.getByTestId('window-options-cancel'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes without saving when backdrop is clicked', async () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSave, onOpenChange });

    await user.click(screen.getByTestId('window-options-backdrop'));

    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes without saving when escape key is pressed', async () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onSave, onOpenChange });

    await user.keyboard('{Escape}');

    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onFitContent and closes when Fit is clicked', async () => {
    const onFitContent = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onFitContent, onOpenChange });

    await user.click(screen.getByTestId('window-options-fit-content'));

    expect(onFitContent).toHaveBeenCalledWith();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('resets selection when reopened', () => {
    const { rerender } = render(
      <ThemeProvider>
        <WindowOptionsDialog
          open={true}
          onOpenChange={vi.fn()}
          preserveWindowState={true}
          onSave={vi.fn()}
        />
      </ThemeProvider>
    );

    // Verify initial state
    expect(screen.getByTestId('window-state-preserve-radio')).toBeChecked();

    // Close the dialog
    rerender(
      <ThemeProvider>
        <WindowOptionsDialog
          open={false}
          onOpenChange={vi.fn()}
          preserveWindowState={false}
          onSave={vi.fn()}
        />
      </ThemeProvider>
    );

    // Reopen with different preserveWindowState
    rerender(
      <ThemeProvider>
        <WindowOptionsDialog
          open={true}
          onOpenChange={vi.fn()}
          preserveWindowState={false}
          onSave={vi.fn()}
        />
      </ThemeProvider>
    );

    // Should reflect new preserveWindowState value
    expect(screen.getByTestId('window-state-default-radio')).toBeChecked();
    expect(screen.getByTestId('window-state-preserve-radio')).not.toBeChecked();
  });

  it('traps focus within the dialog', async () => {
    const user = userEvent.setup();
    renderDialog({});

    const preserveRadio = screen.getByTestId('window-state-preserve-radio');
    const fitButton = screen.getByTestId('window-options-fit-content');
    const cancelButton = screen.getByTestId('window-options-cancel');
    const okButton = screen.getByTestId('window-options-ok');

    // Focus the first radio
    preserveRadio.focus();
    expect(document.activeElement).toBe(preserveRadio);

    // Tab skips to fit button (radio group is single tab stop)
    await user.tab();
    expect(document.activeElement).toBe(fitButton);

    await user.tab();
    expect(document.activeElement).toBe(cancelButton);

    await user.tab();
    expect(document.activeElement).toBe(okButton);

    // Tab should wrap back to first element (radio group)
    await user.tab();
    expect(document.activeElement).toBe(preserveRadio);
  });

  it('traps focus in reverse with shift+tab', async () => {
    const user = userEvent.setup();
    renderDialog({});

    const preserveRadio = screen.getByTestId('window-state-preserve-radio');
    const okButton = screen.getByTestId('window-options-ok');

    // Focus the first radio
    preserveRadio.focus();
    expect(document.activeElement).toBe(preserveRadio);

    // Shift+Tab should wrap to last element
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(okButton);
  });

  it('preserves user selection if props change while open', async () => {
    const user = userEvent.setup();
    const { rerender } = renderDialog({ preserveWindowState: true });

    // User selects the 'default' option
    await user.click(screen.getByTestId('window-state-default-radio'));
    expect(screen.getByTestId('window-state-default-radio')).toBeChecked();

    // Rerender with the same props, simulating a parent component update.
    // With the original code, this would cause the selection to reset.
    rerender(
      <ThemeProvider>
        <WindowOptionsDialog
          open={true}
          onOpenChange={vi.fn()}
          preserveWindowState={true}
          onSave={vi.fn()}
        />
      </ThemeProvider>
    );

    // The user's selection should be preserved
    expect(screen.getByTestId('window-state-default-radio')).toBeChecked();
  });
});
