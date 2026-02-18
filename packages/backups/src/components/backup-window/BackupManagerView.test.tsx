import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackupManagerView } from './BackupManagerView';
import { configureBackupsRuntime } from '../../runtime/backupsRuntime';

const {
  mockListStoredBackups,
  mockGetBackupStorageUsed,
  mockReadBackupFromStorage,
  mockDeleteBackupFromStorage,
  mockSaveFile,
  mockCreateBackup,
  mockSaveBackupToStorage,
  mockEstimateBackupSize
} = vi.hoisted(() => ({
  mockListStoredBackups: vi.fn().mockResolvedValue([
    {
      name: 'test-backup.tbu',
      size: 1024,
      lastModified: Date.now()
    }
  ]),
  mockGetBackupStorageUsed: vi.fn().mockResolvedValue(1024),
  mockReadBackupFromStorage: vi
    .fn()
    .mockResolvedValue(new Uint8Array([1, 2, 3])),
  mockDeleteBackupFromStorage: vi.fn().mockResolvedValue(undefined),
  mockSaveFile: vi.fn().mockResolvedValue(undefined),
  mockCreateBackup: vi.fn().mockResolvedValue({
    filename: 'test-backup.tbu',
    destination: 'storage'
  }),
  mockSaveBackupToStorage: vi.fn().mockResolvedValue(undefined),
  mockEstimateBackupSize: vi.fn().mockResolvedValue({
    blobCount: 5,
    blobTotalSize: 1024 * 1024
  })
}));

vi.mock('./RestoreBackupForm', () => ({
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

describe('BackupManagerView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListStoredBackups.mockResolvedValue([
      {
        name: 'test-backup.tbu',
        size: 1024,
        lastModified: Date.now()
      }
    ]);
    configureBackupsRuntime({
      estimateBackupSize: (includeBlobs) => mockEstimateBackupSize(includeBlobs),
      createBackup: (input) => mockCreateBackup(input),
      getBackupInfo: vi.fn(),
      restoreBackup: vi.fn(),
      refreshInstances: vi.fn(),
      isBackupStorageSupported: () => true,
      listStoredBackups: () => mockListStoredBackups(),
      getBackupStorageUsed: () => mockGetBackupStorageUsed(),
      readBackupFromStorage: (filename) => mockReadBackupFromStorage(filename),
      deleteBackupFromStorage: (filename) =>
        mockDeleteBackupFromStorage(filename),
      saveFile: (data, filename) => mockSaveFile(data, filename)
    });
  });

  it('shows Create Backup section', async () => {
    render(<BackupManagerView />);
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Create Backup' })
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByLabelText('Confirm')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Create Backup' })
      ).toBeInTheDocument();
    });
  });

  it('shows Stored Backups section when supported', async () => {
    render(<BackupManagerView />);
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Stored Backups' })
      ).toBeInTheDocument();
    });
  });

  it('shows Restore from File section', async () => {
    render(<BackupManagerView />);
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Restore from File' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Select Backup File (.tbu)' })
      ).toBeInTheDocument();
    });
  });

  it('shows include files checkbox with estimate', async () => {
    render(<BackupManagerView />);
    await waitFor(() => {
      expect(screen.getByText(/Include files/)).toBeInTheDocument();
      expect(screen.getByText(/\(5, 1 MB\)/)).toBeInTheDocument();
    });
  });

  it('disables Create Backup button when passwords are empty', async () => {
    render(<BackupManagerView />);
    await waitFor(() => {
      const createButton = screen.getByRole('button', {
        name: 'Create Backup'
      });
      expect(createButton).toBeDisabled();
    });
  });

  it('enables Create Backup button when passwords are filled', async () => {
    const user = userEvent.setup();
    render(<BackupManagerView />);

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

  it('displays stored backups in table', async () => {
    render(<BackupManagerView />);
    await waitFor(() => {
      expect(screen.getByText('test-backup.tbu')).toBeInTheDocument();
      expect(screen.getByText('1 KB')).toBeInTheDocument();
    });
  });

  it('shows storage usage', async () => {
    render(<BackupManagerView />);
    await waitFor(() => {
      expect(screen.getByText('1 KB used')).toBeInTheDocument();
    });
  });

  it('has Refresh button', async () => {
    render(<BackupManagerView />);
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Refresh' })
      ).toBeInTheDocument();
    });
  });

  it('refreshes backups list when Refresh is clicked', async () => {
    const user = userEvent.setup();
    render(<BackupManagerView />);

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

  it('shows Restore, Download, and Delete buttons for each backup', async () => {
    render(<BackupManagerView />);
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
    render(<BackupManagerView />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Restore' })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => {
      expect(mockReadBackupFromStorage).toHaveBeenCalledWith('test-backup.tbu');
      expect(screen.getByTestId('restore-backup-form')).toBeInTheDocument();
    });
  });

  it('downloads backup when Download is clicked', async () => {
    const user = userEvent.setup();
    render(<BackupManagerView />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Download' })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => {
      expect(mockReadBackupFromStorage).toHaveBeenCalledWith('test-backup.tbu');
      expect(mockSaveFile).toHaveBeenCalled();
    });
  });

  it('deletes backup when Delete is clicked', async () => {
    const user = userEvent.setup();
    render(<BackupManagerView />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Delete' })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteBackupFromStorage).toHaveBeenCalledWith(
        'test-backup.tbu'
      );
    });
  });

  it('shows no backups message when list is empty', async () => {
    mockListStoredBackups.mockResolvedValue([]);
    render(<BackupManagerView />);
    await waitFor(() => {
      expect(screen.getByText('No stored backups yet.')).toBeInTheDocument();
    });
  });

  it('can toggle include files checkbox', async () => {
    const user = userEvent.setup();
    render(<BackupManagerView />);

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
    render(<BackupManagerView />);

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

  it('clears restore form when Clear is clicked', async () => {
    const user = userEvent.setup();
    render(<BackupManagerView />);

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
