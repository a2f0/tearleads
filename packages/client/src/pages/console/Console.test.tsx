import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Console } from './Console';

const mockSetup = vi.fn();
const mockUnlock = vi.fn();
const mockRestoreSession = vi.fn();
const mockLock = vi.fn();
const mockExportDatabase = vi.fn();
const mockImportDatabase = vi.fn();
const mockChangePassword = vi.fn();

const mockContext = {
  isLoading: false,
  isSetUp: false,
  isUnlocked: false,
  hasPersistedSession: false,
  currentInstanceName: 'Default',
  setup: mockSetup,
  unlock: mockUnlock,
  restoreSession: mockRestoreSession,
  lock: mockLock,
  exportDatabase: mockExportDatabase,
  importDatabase: mockImportDatabase,
  changePassword: mockChangePassword
};

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockContext
}));

const mockSaveFile = vi.fn();
vi.mock('@/lib/file-utils', () => ({
  generateBackupFilename: vi.fn(() => 'rapid-backup.db'),
  readFileAsUint8Array: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
  saveFile: (...args: unknown[]) => mockSaveFile(...args)
}));

function renderConsole() {
  return render(
    <MemoryRouter>
      <Console />
    </MemoryRouter>
  );
}

describe('Console', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.isLoading = false;
    mockContext.isSetUp = false;
    mockContext.isUnlocked = false;
    mockContext.hasPersistedSession = false;
    mockContext.currentInstanceName = 'Default';
    mockSetup.mockResolvedValue(true);
    mockUnlock.mockResolvedValue(true);
    mockRestoreSession.mockResolvedValue(true);
    mockLock.mockResolvedValue(undefined);
    mockExportDatabase.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockImportDatabase.mockResolvedValue(undefined);
    mockChangePassword.mockResolvedValue(true);
    mockSaveFile.mockResolvedValue(undefined);
  });

  it('renders the console title and status', () => {
    renderConsole();

    expect(screen.getByText('Console')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('runs setup when passwords match', async () => {
    const user = userEvent.setup();
    renderConsole();

    await user.type(
      screen.getByTestId('console-setup-password'),
      'testpass123'
    );
    await user.type(screen.getByTestId('console-setup-confirm'), 'testpass123');
    await user.click(screen.getByTestId('console-setup-button'));

    await waitFor(() => {
      expect(mockSetup).toHaveBeenCalledWith('testpass123');
    });
  });

  it('logs when setup is already complete', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    renderConsole();

    await user.type(
      screen.getByTestId('console-setup-password'),
      'testpass123'
    );
    await user.type(
      screen.getByTestId('console-setup-confirm'),
      'testpass123'
    );
    await user.click(screen.getByTestId('console-setup-button'));

    await waitFor(() => {
      expect(
        screen.getByText('Database already set up.')
      ).toBeInTheDocument();
    });
  });

  it('disables setup button when passwords are missing', () => {
    renderConsole();

    expect(screen.getByTestId('console-setup-button')).toBeDisabled();
  });

  it('logs when setup passwords do not match', async () => {
    const user = userEvent.setup();
    renderConsole();

    await user.type(
      screen.getByTestId('console-setup-password'),
      'testpass123'
    );
    await user.type(screen.getByTestId('console-setup-confirm'), 'mismatch');
    await user.click(screen.getByTestId('console-setup-button'));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    });
  });

  it('disables unlock when database is not set up', async () => {
    const user = userEvent.setup();
    renderConsole();

    await user.type(
      screen.getByTestId('console-unlock-password'),
      'testpass123'
    );

    expect(screen.getByTestId('console-unlock-button')).toBeDisabled();
  });

  it('exports a backup when unlocked', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    renderConsole();

    await user.click(screen.getByTestId('console-backup-button'));

    await waitFor(() => {
      expect(mockExportDatabase).toHaveBeenCalledTimes(1);
    });
    expect(mockSaveFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'rapid-backup.db'
    );
  });

  it('logs when unlock fails with incorrect password', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockUnlock.mockResolvedValue(false);
    renderConsole();

    await user.type(
      screen.getByTestId('console-unlock-password'),
      'wrongpass'
    );
    await user.click(screen.getByTestId('console-unlock-button'));

    await waitFor(() => {
      expect(screen.getByText('Incorrect password.')).toBeInTheDocument();
    });
  });

  it('unlocks the database with persisted session', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    renderConsole();

    await user.type(
      screen.getByTestId('console-unlock-password'),
      'testpass123'
    );
    await user.click(screen.getByTestId('console-unlock-persist'));
    await user.click(screen.getByTestId('console-unlock-button'));

    await waitFor(() => {
      expect(mockUnlock).toHaveBeenCalledWith('testpass123', true);
    });
    expect(
      screen.getByText('Database unlocked (session persisted).')
    ).toBeInTheDocument();
  });

  it('logs when restore session is not available', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.hasPersistedSession = true;
    mockRestoreSession.mockResolvedValue(false);
    renderConsole();

    await user.click(screen.getByTestId('console-restore-session-button'));

    await waitFor(() => {
      expect(
        screen.getByText('No persisted session found.')
      ).toBeInTheDocument();
    });
  });

  it('restores a session successfully', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.hasPersistedSession = true;
    mockRestoreSession.mockResolvedValue(true);
    renderConsole();

    await user.click(screen.getByTestId('console-restore-session-button'));

    await waitFor(() => {
      expect(
        screen.getByText('Database unlocked (session restored).')
      ).toBeInTheDocument();
    });
  });

  it('logs when backup requested while locked', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    mockContext.hasPersistedSession = false;
    renderConsole();

    await user.click(screen.getByTestId('console-backup-button'));

    await waitFor(() => {
      expect(
        screen.getByText('Database locked. Unlock first.')
      ).toBeInTheDocument();
    });
  });

  it('backs up after restoring the session', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    mockContext.hasPersistedSession = true;
    mockRestoreSession.mockResolvedValue(true);
    renderConsole();

    await user.click(screen.getByTestId('console-backup-button'));

    await waitFor(() => {
      expect(screen.getByText('Session restored.')).toBeInTheDocument();
    });
    expect(mockExportDatabase).toHaveBeenCalledTimes(1);
  });

  it('logs when session restore fails during backup', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    mockContext.hasPersistedSession = true;
    mockRestoreSession.mockResolvedValue(false);
    renderConsole();

    await user.click(screen.getByTestId('console-backup-button'));

    await waitFor(() => {
      expect(screen.getByText('Session expired. Unlock first.')).toBeInTheDocument();
    });
  });

  it('logs when restore file has invalid extension', async () => {
    renderConsole();

    const input = screen.getByTestId('dropzone-input');
    const file = new File(['test'], 'backup.txt', {
      type: 'text/plain'
    });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(
        screen.getByText('Please select a .db backup file.')
      ).toBeInTheDocument();
    });
  });

  it('restores a backup after confirmation', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    renderConsole();

    const input = screen.getByTestId('dropzone-input');
    const file = new File(['test'], 'backup.db', {
      type: 'application/octet-stream'
    });

    await user.upload(input, file);

    await waitFor(() => {
      expect(
        screen.getByText('Warning: This will replace your current data')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('console-restore-confirm'));

    await waitFor(() => {
      expect(mockImportDatabase).toHaveBeenCalledTimes(1);
    });
    expect(mockLock).toHaveBeenCalledTimes(1);
  });

  it('cancels the restore confirmation prompt', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    renderConsole();

    const input = screen.getByTestId('dropzone-input');
    const file = new File(['test'], 'backup.db', {
      type: 'application/octet-stream'
    });

    await user.upload(input, file);
    await user.click(screen.getByText('Cancel'));

    await waitFor(() => {
      expect(
        screen.queryByText('Warning: This will replace your current data')
      ).not.toBeInTheDocument();
    });
  });

  it('logs when restore is attempted before setup', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = false;
    renderConsole();

    const input = screen.getByTestId('dropzone-input');
    const file = new File(['test'], 'backup.db', {
      type: 'application/octet-stream'
    });

    await user.upload(input, file);
    await user.click(screen.getByTestId('console-restore-confirm'));

    await waitFor(() => {
      expect(
        screen.getByText('Database not set up. Run setup first.')
      ).toBeInTheDocument();
    });
    expect(mockImportDatabase).not.toHaveBeenCalled();
  });

  it('logs when lock clears the persisted session', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockContext.hasPersistedSession = true;
    renderConsole();

    await user.click(screen.getByTestId('console-lock-clear-button'));

    await waitFor(() => {
      expect(mockLock).toHaveBeenCalledWith(true);
    });
    expect(
      screen.getByText('Database locked (session cleared).')
    ).toBeInTheDocument();
  });

  it('locks without clearing session', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    renderConsole();

    await user.click(screen.getByTestId('console-lock-button'));

    await waitFor(() => {
      expect(mockLock).toHaveBeenCalledWith(false);
    });
    expect(screen.getByText('Database locked.')).toBeInTheDocument();
  });

  it('logs when changing password without current password', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    renderConsole();

    await user.type(screen.getByTestId('console-password-new'), 'newpassword');
    await user.type(
      screen.getByTestId('console-password-confirm'),
      'newpassword'
    );
    await user.click(screen.getByTestId('console-password-button'));

    await waitFor(() => {
      expect(
        screen.getByText('Current password cannot be empty.')
      ).toBeInTheDocument();
    });
  });

  it('changes password successfully', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockChangePassword.mockResolvedValue(true);
    renderConsole();

    await user.type(
      screen.getByTestId('console-password-current'),
      'oldpassword'
    );
    await user.type(screen.getByTestId('console-password-new'), 'newpassword');
    await user.type(
      screen.getByTestId('console-password-confirm'),
      'newpassword'
    );
    await user.click(screen.getByTestId('console-password-button'));

    await waitFor(() => {
      expect(
        screen.getByText('Password changed successfully.')
      ).toBeInTheDocument();
    });
  });

  it('logs when current password is incorrect', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockChangePassword.mockResolvedValue(false);
    renderConsole();

    await user.type(
      screen.getByTestId('console-password-current'),
      'oldpassword'
    );
    await user.type(screen.getByTestId('console-password-new'), 'newpassword');
    await user.type(
      screen.getByTestId('console-password-confirm'),
      'newpassword'
    );
    await user.click(screen.getByTestId('console-password-button'));

    await waitFor(() => {
      expect(
        screen.getByText('Incorrect current password.')
      ).toBeInTheDocument();
    });
  });

  it('clears console output', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    renderConsole();

    await user.click(screen.getByTestId('console-backup-button'));

    await waitFor(() => {
      expect(
        screen.getByText('Database locked. Unlock first.')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('console-clear-output'));

    await waitFor(() => {
      expect(screen.getByText('No output yet.')).toBeInTheDocument();
    });
  });
});
