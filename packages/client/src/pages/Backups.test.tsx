import { ThemeProvider } from '@rapid/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Backups } from './Backups';

const {
  mockListStoredBackups,
  mockGetBackupStorageUsed,
  mockReadBackupFromStorage,
  mockDeleteBackupFromStorage,
  mockSaveFile,
  mockCreateBackup,
  mockSaveBackupToStorage
} = vi.hoisted(() => ({
  mockListStoredBackups: vi.fn().mockResolvedValue([]),
  mockGetBackupStorageUsed: vi.fn().mockResolvedValue(0),
  mockReadBackupFromStorage: vi
    .fn()
    .mockResolvedValue(new Uint8Array([1, 2, 3])),
  mockDeleteBackupFromStorage: vi.fn().mockResolvedValue(undefined),
  mockSaveFile: vi.fn().mockResolvedValue(undefined),
  mockCreateBackup: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  mockSaveBackupToStorage: vi.fn().mockResolvedValue(undefined)
}));

// Mock database and storage dependencies
vi.mock('@/db', () => ({
  getCurrentInstanceId: () => 'test-instance',
  getDatabaseAdapter: () => ({})
}));

vi.mock('@/db/backup', () => ({
  createBackup: mockCreateBackup,
  estimateBackupSize: vi.fn().mockResolvedValue({
    blobCount: 5,
    blobTotalSize: 1024 * 1024
  })
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: () => ({
    getCurrentKey: () => new Uint8Array(32)
  })
}));

vi.mock('@/db/instance-registry', () => ({
  getActiveInstance: vi.fn().mockResolvedValue({ name: 'Test Instance' })
}));

vi.mock('@/lib/file-utils', () => ({
  saveFile: mockSaveFile
}));

vi.mock('@/storage/backup-storage', () => ({
  isBackupStorageSupported: () => true,
  listStoredBackups: mockListStoredBackups,
  getBackupStorageUsed: mockGetBackupStorageUsed,
  saveBackupToStorage: mockSaveBackupToStorage,
  readBackupFromStorage: mockReadBackupFromStorage,
  deleteBackupFromStorage: mockDeleteBackupFromStorage
}));

vi.mock('@/storage/opfs', () => ({
  isFileStorageInitialized: () => true,
  getFileStorageForInstance: () => ({}),
  initializeFileStorage: vi.fn()
}));

vi.mock('@/components/backup-window/RestoreBackupForm', () => ({
  RestoreBackupForm: ({
    backupName,
    onClear
  }: {
    backupName: string;
    backupData: Uint8Array;
    onClear?: () => void;
  }) => (
    <div data-testid="restore-backup-form">
      Restoring: {backupName}
      <button type="button" onClick={onClear}>
        Clear
      </button>
    </div>
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockListStoredBackups.mockResolvedValue([]);
  });

  it('renders page title and all sections', async () => {
    renderBackups();

    await waitFor(() => {
      expect(screen.getByText('menu:backups')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Create Backup' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Stored Backups' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Restore from File' })
      ).toBeInTheDocument();
    });
  });

  it('shows create backup form with password fields', async () => {
    renderBackups();

    await waitFor(() => {
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByLabelText('Confirm')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Create Backup' })
      ).toBeInTheDocument();
    });
  });

  it('shows restore from file button', async () => {
    renderBackups();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Select Backup File (.rbu)' })
      ).toBeInTheDocument();
    });
  });

  it('hides back link when showBackLink is false', async () => {
    renderBackups({ showBackLink: false });

    await waitFor(() => {
      expect(screen.queryByText('Back to Home')).not.toBeInTheDocument();
    });
  });

  it('shows include files checkbox with estimate', async () => {
    renderBackups();
    await waitFor(() => {
      expect(screen.getByText(/Include files/)).toBeInTheDocument();
      expect(screen.getByText(/\(5, 1 MB\)/)).toBeInTheDocument();
    });
  });

  it('disables Create Backup button when passwords are empty', async () => {
    renderBackups();
    await waitFor(() => {
      const createButton = screen.getByRole('button', {
        name: 'Create Backup'
      });
      expect(createButton).toBeDisabled();
    });
  });

  it('enables Create Backup button when passwords are filled', async () => {
    const user = userEvent.setup();
    renderBackups();

    await waitFor(() => {
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Password'), 'testpass');
    await user.type(screen.getByLabelText('Confirm'), 'testpass');

    await waitFor(() => {
      const createButton = screen.getByRole('button', {
        name: 'Create Backup'
      });
      expect(createButton).not.toBeDisabled();
    });
  });

  it('displays stored backups in table when available', async () => {
    mockListStoredBackups.mockResolvedValue([
      {
        name: 'test-backup.rbu',
        size: 1024,
        lastModified: Date.now()
      }
    ]);
    mockGetBackupStorageUsed.mockResolvedValue(1024);

    renderBackups();
    await waitFor(() => {
      expect(screen.getByText('test-backup.rbu')).toBeInTheDocument();
      expect(screen.getByText('1 KB')).toBeInTheDocument();
    });
  });

  it('shows no backups message when list is empty', async () => {
    mockListStoredBackups.mockResolvedValue([]);
    renderBackups();
    await waitFor(() => {
      expect(screen.getByText('No stored backups yet.')).toBeInTheDocument();
    });
  });

  it('has Refresh button', async () => {
    renderBackups();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });
  });

  it('refreshes backups list when Refresh is clicked', async () => {
    const user = userEvent.setup();
    renderBackups();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });

    mockListStoredBackups.mockClear();
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(mockListStoredBackups).toHaveBeenCalled();
    });
  });

  it('can toggle include files checkbox', async () => {
    const user = userEvent.setup();
    renderBackups();

    await waitFor(() => {
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it('creates backup when form is submitted', async () => {
    const user = userEvent.setup();
    renderBackups();

    await waitFor(() => {
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Password'), 'testpass');
    await user.type(screen.getByLabelText('Confirm'), 'testpass');
    await user.click(screen.getByRole('button', { name: 'Create Backup' }));

    await waitFor(() => {
      expect(mockCreateBackup).toHaveBeenCalled();
    });
  });

  it('shows Restore, Download, and Delete buttons for each backup', async () => {
    mockListStoredBackups.mockResolvedValue([
      {
        name: 'test-backup.rbu',
        size: 1024,
        lastModified: Date.now()
      }
    ]);

    renderBackups();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Restore' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Download' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Delete' })
      ).toBeInTheDocument();
    });
  });

  it('loads backup data when Restore is clicked', async () => {
    const user = userEvent.setup();
    mockListStoredBackups.mockResolvedValue([
      {
        name: 'test-backup.rbu',
        size: 1024,
        lastModified: Date.now()
      }
    ]);

    renderBackups();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Restore' })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => {
      expect(mockReadBackupFromStorage).toHaveBeenCalledWith('test-backup.rbu');
      expect(screen.getByTestId('restore-backup-form')).toBeInTheDocument();
    });
  });

  it('downloads backup when Download is clicked', async () => {
    const user = userEvent.setup();
    mockListStoredBackups.mockResolvedValue([
      {
        name: 'test-backup.rbu',
        size: 1024,
        lastModified: Date.now()
      }
    ]);

    renderBackups();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Download' })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => {
      expect(mockReadBackupFromStorage).toHaveBeenCalledWith('test-backup.rbu');
      expect(mockSaveFile).toHaveBeenCalled();
    });
  });

  it('deletes backup when Delete is clicked', async () => {
    const user = userEvent.setup();
    mockListStoredBackups.mockResolvedValue([
      {
        name: 'test-backup.rbu',
        size: 1024,
        lastModified: Date.now()
      }
    ]);

    renderBackups();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Delete' })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteBackupFromStorage).toHaveBeenCalledWith(
        'test-backup.rbu'
      );
    });
  });

  it('clears restore form when Clear is clicked', async () => {
    const user = userEvent.setup();
    mockListStoredBackups.mockResolvedValue([
      {
        name: 'test-backup.rbu',
        size: 1024,
        lastModified: Date.now()
      }
    ]);

    renderBackups();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Restore' })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => {
      expect(screen.getByTestId('restore-backup-form')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(
        screen.queryByTestId('restore-backup-form')
      ).not.toBeInTheDocument();
    });
  });
});
