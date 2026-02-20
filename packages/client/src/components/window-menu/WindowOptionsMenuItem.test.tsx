import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowOptionsMenuItem } from './WindowOptionsMenuItem';

const mockSetPreserveWindowState = vi.fn();
let mockPreserveWindowState = true;

vi.mock('@/hooks/window', () => ({
  usePreserveWindowState: () => ({
    preserveWindowState: mockPreserveWindowState,
    setPreserveWindowState: mockSetPreserveWindowState
  })
}));

function renderMenuItem() {
  return render(
    <ThemeProvider>
      <div className="floating-window" data-testid="floating-window-container">
        <WindowOptionsMenuItem />
      </div>
    </ThemeProvider>
  );
}

describe('WindowOptionsMenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreserveWindowState = true;
  });

  it('renders the menu item', () => {
    renderMenuItem();
    expect(screen.getByText('Options')).toBeInTheDocument();
  });

  it('opens dialog when menu item is clicked', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    await user.click(screen.getByText('Options'));

    expect(screen.getByTestId('window-options-dialog')).toBeInTheDocument();
  });

  it('calls setPreserveWindowState when dialog is saved with preserve option', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Options'));

    // Click OK (preserve is already selected)
    await user.click(screen.getByTestId('window-options-ok'));

    expect(mockSetPreserveWindowState).toHaveBeenCalledWith(true);
  });

  it('calls setPreserveWindowState with false when dialog is saved with default option', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Options'));

    // Select default option
    await user.click(screen.getByTestId('window-state-default-radio'));

    // Click OK
    await user.click(screen.getByTestId('window-options-ok'));

    expect(mockSetPreserveWindowState).toHaveBeenCalledWith(false);
  });

  it('does not call setPreserveWindowState when dialog is cancelled', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Options'));

    // Click Cancel
    await user.click(screen.getByTestId('window-options-cancel'));

    expect(mockSetPreserveWindowState).not.toHaveBeenCalled();
  });

  it('closes dialog after saving', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Options'));
    expect(screen.getByTestId('window-options-dialog')).toBeInTheDocument();

    // Click OK
    await user.click(screen.getByTestId('window-options-ok'));

    expect(
      screen.queryByTestId('window-options-dialog')
    ).not.toBeInTheDocument();
  });

  it('closes dialog after cancelling', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Options'));
    expect(screen.getByTestId('window-options-dialog')).toBeInTheDocument();

    // Click Cancel
    await user.click(screen.getByTestId('window-options-cancel'));

    expect(
      screen.queryByTestId('window-options-dialog')
    ).not.toBeInTheDocument();
  });

  it('reflects current preserveWindowState in dialog', async () => {
    mockPreserveWindowState = false;
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Options'));

    // Default option should be selected since preserveWindowState is false
    expect(screen.getByTestId('window-state-default-radio')).toBeChecked();
    expect(screen.getByTestId('window-state-preserve-radio')).not.toBeChecked();
  });

  it('does not dismiss dialog when clicking radio buttons', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Options'));
    expect(screen.getByTestId('window-options-dialog')).toBeInTheDocument();

    // Click on the default radio button
    await user.click(screen.getByTestId('window-state-default-radio'));

    // Dialog should still be open
    expect(screen.getByTestId('window-options-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('window-state-default-radio')).toBeChecked();

    // Click on the preserve radio button
    await user.click(screen.getByTestId('window-state-preserve-radio'));

    // Dialog should still be open
    expect(screen.getByTestId('window-options-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('window-state-preserve-radio')).toBeChecked();
  });
});
