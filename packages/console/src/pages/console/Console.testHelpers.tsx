import { render } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { setConsoleTerminalDependencies } from '../../lib/terminalDependencies';
import { Console } from './Console';

export const mockSetup = vi.fn();
export const mockUnlock = vi.fn();
export const mockRestoreSession = vi.fn();
export const mockLock = vi.fn();
export const mockExportDatabase = vi.fn();
export const mockImportDatabase = vi.fn();
export const mockChangePassword = vi.fn();
export const mockSwitchInstance = vi.fn();

export const mockContext = {
  isLoading: false,
  isSetUp: false,
  isUnlocked: false,
  hasPersistedSession: false,
  currentInstanceId: 'instance-default',
  currentInstanceName: 'Default',
  instances: [{ id: 'instance-default', name: 'Default' }],
  setup: mockSetup,
  unlock: mockUnlock,
  restoreSession: mockRestoreSession,
  lock: mockLock,
  exportDatabase: mockExportDatabase,
  importDatabase: mockImportDatabase,
  changePassword: mockChangePassword,
  switchInstance: mockSwitchInstance
};

export const mockSaveFile = vi.fn();
export const mockGetErrorMessage = vi.fn((error: unknown) =>
  error instanceof Error ? error.message : String(error)
);
export const mockGenerateBackupFilename = vi.fn(() => 'tearleads-backup.db');
export const mockReadFileAsUint8Array = vi.fn(() =>
  Promise.resolve(new Uint8Array([1, 2, 3]))
);

function TestAccountSwitcher() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        data-testid="account-switcher-button"
        onClick={() => setOpen((prev) => !prev)}
      >
        Account Switcher
      </button>
      {open && (
        <div data-testid="account-switcher-menu">
          {mockContext.instances.map((instance) => (
            <div
              key={instance.id}
              data-testid={`instance-unlocked-${instance.id}`}
            >
              {instance.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function renderConsole() {
  return render(
    <MemoryRouter>
      <Console />
    </MemoryRouter>
  );
}

export function renderConsoleWithAccountSwitcher() {
  return render(
    <MemoryRouter>
      <div>
        <TestAccountSwitcher />
        <Console />
      </div>
    </MemoryRouter>
  );
}

export function resetConsoleTestState(): void {
  vi.clearAllMocks();
  mockContext.isLoading = false;
  mockContext.isSetUp = false;
  mockContext.isUnlocked = false;
  mockContext.hasPersistedSession = false;
  mockContext.currentInstanceId = 'instance-default';
  mockContext.currentInstanceName = 'Default';
  mockContext.instances = [{ id: 'instance-default', name: 'Default' }];
  mockSetup.mockResolvedValue(true);
  mockUnlock.mockResolvedValue(true);
  mockRestoreSession.mockResolvedValue(true);
  mockLock.mockResolvedValue(undefined);
  mockExportDatabase.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockImportDatabase.mockResolvedValue(undefined);
  mockChangePassword.mockResolvedValue(true);
  mockSwitchInstance.mockResolvedValue(true);
  mockSaveFile.mockResolvedValue(undefined);
  mockGenerateBackupFilename.mockReturnValue('tearleads-backup.db');
  mockReadFileAsUint8Array.mockResolvedValue(new Uint8Array([1, 2, 3]));
  setConsoleTerminalDependencies({
    useDatabaseContext: () => mockContext,
    utilities: {
      getErrorMessage: (error) => mockGetErrorMessage(error),
      generateBackupFilename: () => mockGenerateBackupFilename(),
      readFileAsUint8Array: (file) => mockReadFileAsUint8Array(file),
      saveFile: (data, filename) => mockSaveFile(data, filename)
    }
  });
}
