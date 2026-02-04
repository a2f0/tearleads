import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StoredBackupsTab } from './StoredBackupsTab';

const mockIsSupported = vi.fn();
const mockListBackups = vi.fn();
const mockStorageUsed = vi.fn();
const mockReadBackup = vi.fn();
const mockDeleteBackup = vi.fn();
const mockSaveFile = vi.fn();

vi.mock('@/storage/backup-storage', () => ({
  isBackupStorageSupported: () => mockIsSupported(),
  listStoredBackups: () => mockListBackups(),
  getBackupStorageUsed: () => mockStorageUsed(),
  readBackupFromStorage: () => mockReadBackup(),
  deleteBackupFromStorage: () => mockDeleteBackup()
}));

vi.mock('@/lib/file-utils', () => ({
  saveFile: () => mockSaveFile()
}));

vi.mock('./RestoreBackupForm', () => ({
  RestoreBackupForm: () => <div data-testid="restore-backup-form" />
}));

describe('StoredBackupsTab', () => {
  it('renders unsupported message when OPFS is unavailable', () => {
    mockIsSupported.mockReturnValue(false);

    render(<StoredBackupsTab />);

    expect(
      screen.getByText(/Local backup storage is only available/i)
    ).toBeInTheDocument();
  });

  it('renders empty state when no backups are stored', async () => {
    mockIsSupported.mockReturnValue(true);
    mockListBackups.mockResolvedValue([]);
    mockStorageUsed.mockResolvedValue(0);

    render(<StoredBackupsTab />);

    expect(
      await screen.findByText(/No stored backups yet/i)
    ).toBeInTheDocument();
  });

  it('renders stored backups list', async () => {
    mockIsSupported.mockReturnValue(true);
    mockListBackups.mockResolvedValue([
      { name: 'backup-1.rbu', size: 1024, lastModified: Date.now() }
    ]);
    mockStorageUsed.mockResolvedValue(1024);

    render(<StoredBackupsTab />);

    expect(await screen.findByText('backup-1.rbu')).toBeInTheDocument();
    expect(screen.getByText('1 KB used')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Download' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('handles restore, download, and delete actions', async () => {
    mockIsSupported.mockReturnValue(true);
    mockListBackups
      .mockResolvedValueOnce([
        { name: 'backup-1.rbu', size: 1024, lastModified: Date.now() }
      ])
      .mockResolvedValueOnce([]);
    mockStorageUsed.mockResolvedValue(1024);
    mockReadBackup.mockResolvedValue(new Uint8Array([1, 2, 3]));

    render(<StoredBackupsTab />);

    const restoreButton = await screen.findByRole('button', {
      name: 'Restore'
    });
    fireEvent.click(restoreButton);
    expect(
      await screen.findByTestId('restore-backup-form')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(mockSaveFile).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockDeleteBackup).toHaveBeenCalled();
    expect(
      await screen.findByText(/No stored backups yet/i)
    ).toBeInTheDocument();
  });
});
