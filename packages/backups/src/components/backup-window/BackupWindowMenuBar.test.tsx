import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BackupWindowMenuBar } from './BackupWindowMenuBar';

vi.mock('@tearleads/backups/package.json', () => ({
  default: { version: '1.2.3' }
}));

describe('BackupWindowMenuBar', () => {
  it('renders menu triggers', () => {
    render(
      <BackupWindowMenuBar onClose={vi.fn()} onOpenDocumentation={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <BackupWindowMenuBar onClose={onClose} onOpenDocumentation={vi.fn()} />
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('shows Options option in View menu', async () => {
    const user = userEvent.setup();
    render(
      <BackupWindowMenuBar onClose={vi.fn()} onOpenDocumentation={vi.fn()} />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Options' })
    ).toBeInTheDocument();
  });

  it('calls onOpenDocumentation from Help menu', async () => {
    const user = userEvent.setup();
    const onOpenDocumentation = vi.fn();
    render(
      <BackupWindowMenuBar
        onClose={vi.fn()}
        onOpenDocumentation={onOpenDocumentation}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'Documentation' }));

    expect(onOpenDocumentation).toHaveBeenCalled();
  });

  it('opens About dialog from Help menu with version', async () => {
    const user = userEvent.setup();
    render(
      <BackupWindowMenuBar onClose={vi.fn()} onOpenDocumentation={vi.fn()} />
    );

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('About Backups')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('1.2.3');
  });
});
