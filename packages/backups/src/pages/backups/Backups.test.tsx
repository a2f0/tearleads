import { ThemeProvider } from '@tearleads/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { Backups } from './Backups';

// Mock BackupManagerView to avoid testing its internals here
vi.mock('../../components/backup-window/BackupManagerView', () => ({
  BackupManagerView: () => (
    <div data-testid="backup-manager-view">BackupManagerView</div>
  )
}));

vi.mock('../../components/backup-window/BackupDocumentation', () => ({
  BackupDocumentation: ({ onBack }: { onBack?: (() => void) | undefined }) => (
    <div data-testid="backup-documentation">
      BackupDocumentation
      {onBack && (
        <button type="button" onClick={onBack}>
          Back to Backup Manager
        </button>
      )}
    </div>
  )
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}));

describe('Backups page', () => {
  const renderBackups = (props = {}) =>
    render(
      <MemoryRouter>
        <ThemeProvider>
          <Backups {...props} />
        </ThemeProvider>
      </MemoryRouter>
    );

  it('renders page title', async () => {
    renderBackups();
    await waitFor(() => {
      expect(screen.getByText('menu:backups')).toBeInTheDocument();
    });
  });

  it('renders BackupManagerView', async () => {
    renderBackups();
    await waitFor(() => {
      expect(screen.getByTestId('backup-manager-view')).toBeInTheDocument();
    });
  });

  it('shows back link by default', async () => {
    renderBackups();
    await waitFor(() => {
      expect(screen.getByTestId('back-link')).toBeInTheDocument();
    });
  });

  it('hides back link when showBackLink is false', async () => {
    renderBackups({ showBackLink: false });
    await waitFor(() => {
      expect(screen.queryByTestId('back-link')).not.toBeInTheDocument();
    });
  });

  it('opens documentation view from Help menu', async () => {
    const user = userEvent.setup();
    renderBackups();

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'Documentation' }));

    expect(screen.getByTestId('backup-documentation')).toBeInTheDocument();
    expect(screen.queryByTestId('backup-manager-view')).not.toBeInTheDocument();
  });

  it('returns to manager view from documentation back action', async () => {
    const user = userEvent.setup();
    renderBackups();

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'Documentation' }));
    await user.click(
      screen.getByRole('button', { name: 'Back to Backup Manager' })
    );

    expect(screen.getByTestId('backup-manager-view')).toBeInTheDocument();
    expect(
      screen.queryByTestId('backup-documentation')
    ).not.toBeInTheDocument();
  });
});
