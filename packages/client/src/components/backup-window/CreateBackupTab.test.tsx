import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock dependencies - returns null to skip estimation
vi.mock('@/db', () => ({
  getCurrentInstanceId: vi.fn(() => null),
  getDatabaseAdapter: vi.fn()
}));

vi.mock('@/db/backup', () => ({
  createBackup: vi.fn(),
  estimateBackupSize: vi.fn()
}));

vi.mock('@/db/instance-registry', () => ({
  getActiveInstance: vi.fn()
}));

vi.mock('@/lib/file-utils', () => ({
  saveFile: vi.fn()
}));

vi.mock('@/storage/backup-storage', () => ({
  isBackupStorageSupported: () => true,
  saveBackupToStorage: vi.fn()
}));

vi.mock('@/db/crypto', () => ({
  getKeyManager: vi.fn(() => ({ getCurrentKey: () => null }))
}));

vi.mock('@/storage/opfs', () => ({
  getFileStorageForInstance: vi.fn(),
  initializeFileStorage: vi.fn(),
  isFileStorageInitialized: vi.fn(() => false)
}));

import { CreateBackupTab } from './CreateBackupTab';

describe('CreateBackupTab', () => {
  it('renders form elements', async () => {
    render(<CreateBackupTab />);
    await waitFor(() => {
      expect(screen.getByText('Create Encrypted Backup')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Backup Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
    expect(screen.getByText('Include file attachments')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create Backup' })
    ).toBeDisabled();
  });

  it('enables button when passwords are entered', async () => {
    render(<CreateBackupTab />);
    await waitFor(() => {
      expect(screen.getByLabelText('Backup Password')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Backup Password'), {
      target: { value: 'password123' }
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'password123' }
    });

    expect(screen.getByRole('button', { name: 'Create Backup' })).toBeEnabled();
  });

  it('shows error when passwords do not match', async () => {
    render(<CreateBackupTab />);
    await waitFor(() => {
      expect(screen.getByLabelText('Backup Password')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Backup Password'), {
      target: { value: 'password123' }
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'different' }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Backup' }));

    expect(
      await screen.findByText('Passwords do not match')
    ).toBeInTheDocument();
  });

  it('can toggle include blobs checkbox', async () => {
    render(<CreateBackupTab />);
    await waitFor(() => {
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });
    const checkbox = screen.getByRole('checkbox');

    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });
});
