import { render, screen, waitFor } from '@testing-library/react';
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
    await user.type(
      screen.getByTestId('console-setup-confirm'),
      'testpass123'
    );
    await user.click(screen.getByTestId('console-setup-button'));

    await waitFor(() => {
      expect(mockSetup).toHaveBeenCalledWith('testpass123');
    });
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
});
