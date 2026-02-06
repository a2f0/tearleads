import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { Backups } from './Backups';

// Mock BackupManagerView to avoid testing its internals here
vi.mock('@/components/backup-window/BackupManagerView', () => ({
  BackupManagerView: () => (
    <div data-testid="backup-manager-view">BackupManagerView</div>
  )
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: (namespace: string) => ({
    t: (key: string) => `${namespace}:${key}`
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
});
