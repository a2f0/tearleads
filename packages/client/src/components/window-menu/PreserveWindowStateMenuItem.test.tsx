import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreserveWindowStateMenuItem } from './PreserveWindowStateMenuItem';

const mockSetPreserveWindowState = vi.fn();
let mockPreserveWindowState = true;

vi.mock('@/hooks/usePreserveWindowState', () => ({
  usePreserveWindowState: () => ({
    preserveWindowState: mockPreserveWindowState,
    setPreserveWindowState: mockSetPreserveWindowState
  })
}));

function renderMenuItem() {
  return render(
    <ThemeProvider>
      <PreserveWindowStateMenuItem />
    </ThemeProvider>
  );
}

describe('PreserveWindowStateMenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreserveWindowState = true;
  });

  it('renders the menu item', () => {
    renderMenuItem();
    expect(screen.getByText('Preserve Window State')).toBeInTheDocument();
  });

  it('opens dialog when menu item is clicked', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    await user.click(screen.getByText('Preserve Window State'));

    expect(
      screen.getByTestId('window-state-settings-dialog')
    ).toBeInTheDocument();
  });

  it('calls setPreserveWindowState when dialog is saved with preserve option', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Preserve Window State'));

    // Click OK (preserve is already selected)
    await user.click(screen.getByTestId('window-state-settings-ok'));

    expect(mockSetPreserveWindowState).toHaveBeenCalledWith(true);
  });

  it('calls setPreserveWindowState with false when dialog is saved with default option', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Preserve Window State'));

    // Select default option
    await user.click(screen.getByTestId('window-state-default-radio'));

    // Click OK
    await user.click(screen.getByTestId('window-state-settings-ok'));

    expect(mockSetPreserveWindowState).toHaveBeenCalledWith(false);
  });

  it('does not call setPreserveWindowState when dialog is cancelled', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Preserve Window State'));

    // Click Cancel
    await user.click(screen.getByTestId('window-state-settings-cancel'));

    expect(mockSetPreserveWindowState).not.toHaveBeenCalled();
  });

  it('closes dialog after saving', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Preserve Window State'));
    expect(
      screen.getByTestId('window-state-settings-dialog')
    ).toBeInTheDocument();

    // Click OK
    await user.click(screen.getByTestId('window-state-settings-ok'));

    expect(
      screen.queryByTestId('window-state-settings-dialog')
    ).not.toBeInTheDocument();
  });

  it('closes dialog after cancelling', async () => {
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Preserve Window State'));
    expect(
      screen.getByTestId('window-state-settings-dialog')
    ).toBeInTheDocument();

    // Click Cancel
    await user.click(screen.getByTestId('window-state-settings-cancel'));

    expect(
      screen.queryByTestId('window-state-settings-dialog')
    ).not.toBeInTheDocument();
  });

  it('reflects current preserveWindowState in dialog', async () => {
    mockPreserveWindowState = false;
    const user = userEvent.setup();
    renderMenuItem();

    // Open dialog
    await user.click(screen.getByText('Preserve Window State'));

    // Default option should be selected since preserveWindowState is false
    expect(screen.getByTestId('window-state-default-radio')).toBeChecked();
    expect(screen.getByTestId('window-state-preserve-radio')).not.toBeChecked();
  });
});
