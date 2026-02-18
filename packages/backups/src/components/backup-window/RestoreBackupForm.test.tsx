import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RestoreBackupForm } from './RestoreBackupForm';
import { configureBackupsRuntime } from '../../runtime/backupsRuntime';

const mockGetBackupInfo = vi.fn();
const mockRestoreBackup = vi.fn();
const mockRefreshInstances = vi.fn();

afterEach(() => {
  vi.useRealTimers();
});

describe('RestoreBackupForm', () => {
  const backupData = new Uint8Array([1, 2, 3]);

  beforeEach(() => {
    mockGetBackupInfo.mockReset();
    mockRestoreBackup.mockReset();
    mockRefreshInstances.mockReset();
    configureBackupsRuntime({
      estimateBackupSize: vi.fn(),
      createBackup: vi.fn(),
      getBackupInfo: (...args) => mockGetBackupInfo(...args),
      restoreBackup: (...args) => mockRestoreBackup(...args),
      refreshInstances: () => Promise.resolve(mockRefreshInstances()),
      isBackupStorageSupported: () => true,
      listStoredBackups: vi.fn(),
      getBackupStorageUsed: vi.fn(),
      readBackupFromStorage: vi.fn(),
      deleteBackupFromStorage: vi.fn(),
      saveFile: vi.fn()
    });
  });

  it('validates a backup and shows manifest details', async () => {
    mockGetBackupInfo.mockResolvedValue({
      manifest: {
        createdAt: '2024-01-02T10:00:00.000Z',
        appVersion: '1.2.3',
        platform: 'web',
        formatVersion: 1,
        blobCount: 1,
        blobTotalSize: 1024
      },
      suggestedName: 'Restored Instance'
    });

    render(
      <RestoreBackupForm backupName="backup-1.tbu" backupData={backupData} />
    );

    fireEvent.change(screen.getByLabelText('Backup Password'), {
      target: { value: 'secret' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate Backup' }));

    expect(await screen.findByText('web')).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Format:')).toBeInTheDocument();
    expect(screen.getByText(/1 KB/)).toBeInTheDocument();
    expect(screen.getByText('Restored Instance')).toBeInTheDocument();
  });

  it('restores a backup and calls onClear', async () => {
    mockGetBackupInfo.mockResolvedValue({
      manifest: {
        createdAt: '2024-01-02T10:00:00.000Z',
        appVersion: '1.2.3',
        platform: 'web',
        formatVersion: 1,
        blobCount: 0,
        blobTotalSize: 0
      },
      suggestedName: 'Restored Instance'
    });
    mockRestoreBackup.mockResolvedValue({ instanceName: 'Restored Instance' });

    const onClear = vi.fn();

    render(
      <RestoreBackupForm
        backupName="backup-1.tbu"
        backupData={backupData}
        onClear={onClear}
      />
    );

    fireEvent.change(screen.getByLabelText('Backup Password'), {
      target: { value: 'secret' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validate Backup' }));
    await screen.findByText('web');

    fireEvent.change(screen.getByLabelText('New Instance Password'), {
      target: { value: 'new-pass' }
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'new-pass' }
    });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Restore Backup' }));
      await vi.runAllTimersAsync();
    });

    expect(mockRestoreBackup).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
    expect(mockRefreshInstances).toHaveBeenCalled();
  });
});
