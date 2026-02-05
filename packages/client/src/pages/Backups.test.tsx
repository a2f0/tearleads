import { ThemeProvider } from '@rapid/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { Backups } from './Backups';

vi.mock('@/components/backup-window', () => ({
  CreateBackupTab: ({
    onSuccess
  }: {
    onSuccess?: (options: { stored: boolean }) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSuccess?.({ stored: true })}>
        Trigger Success
      </button>
      <div data-testid="create-tab">Create Tab</div>
    </div>
  ),
  RestoreBackupTab: () => <div data-testid="restore-tab">Restore Tab</div>,
  StoredBackupsTab: () => <div data-testid="stored-tab">Stored Tab</div>
}));

vi.mock('@/i18n', () => ({
  useTypedTranslation: (namespace: string) => ({
    t: (key: string) => `${namespace}:${key}`
  })
}));

describe('Backups page', () => {
  it('renders tabs and defaults to create', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <Backups />
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('menu:backups')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'common:create' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'common:restore' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'common:stored' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('create-tab')).toBeInTheDocument();
  });

  it('switches tabs when selected', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <Backups />
        </ThemeProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'common:restore' }));
    expect(screen.getByTestId('restore-tab')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'common:stored' }));
    expect(screen.getByTestId('stored-tab')).toBeInTheDocument();
  });

  it('switches to stored after create success', () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <Backups />
        </ThemeProvider>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Success' }));
    expect(screen.getByTestId('stored-tab')).toBeInTheDocument();
  });
});
