import { AccountSwitcher } from '@client/components/AccountSwitcher';
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
const mockSwitchInstance = vi.fn();

const mockContext = {
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

vi.mock('@client/db/hooks', () => ({
  useDatabaseContext: () => mockContext
}));

const mockSaveFile = vi.fn();
vi.mock('@client/lib/fileUtils', () => ({
  generateBackupFilename: vi.fn(() => 'tearleads-backup.db'),
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

function renderConsoleWithAccountSwitcher() {
  return render(
    <MemoryRouter>
      <div>
        <AccountSwitcher />
        <Console />
      </div>
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
  });
  it('logs when new password confirmation mismatches', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'password{Enter}');

    // Current password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Current password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'oldpassword{Enter}');

    // New password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    // Confirm new password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm new password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'mismatch{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    });
  });

  it('changes password successfully', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockChangePassword.mockResolvedValue(true);
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'password{Enter}');

    // Current password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Current password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'oldpassword{Enter}');

    // New password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    // Confirm new password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm new password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Password changed successfully.')
      ).toBeInTheDocument();
    });
  });

  it('logs when password change fails with error', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockChangePassword.mockRejectedValue(new Error('Password exploded'));
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'password{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Current password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'oldpassword{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm new password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Password change failed: Password exploded')
      ).toBeInTheDocument();
    });
  });

  it('logs when current password is incorrect', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockChangePassword.mockResolvedValue(false);
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'password{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Current password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'oldpassword{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm new password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Incorrect current password.')
      ).toBeInTheDocument();
    });
  });

  it('clears console output with clear command', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'backup{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Database locked. Unlock first.')
      ).toBeInTheDocument();
    });

    await user.type(input, 'clear{Enter}');

    await waitFor(() => {
      expect(
        screen.queryByText('Database locked. Unlock first.')
      ).not.toBeInTheDocument();
    });
  });

  it('shows status information', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'status{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Instance:.*Default/)).toBeInTheDocument();
      expect(screen.getByText(/Database:.*Locked/)).toBeInTheDocument();
    });
  });

  it('shows help for available commands', async () => {
    const user = userEvent.setup();
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'help{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Available commands:')).toBeInTheDocument();
    });
  });

  it('switches to another instance', async () => {
    const user = userEvent.setup();
    mockContext.currentInstanceId = 'instance-1';
    mockContext.currentInstanceName = 'Instance 1';
    mockContext.instances = [
      { id: 'instance-1', name: 'Instance 1' },
      { id: 'instance-2', name: 'Instance 2' }
    ];
    mockSwitchInstance.mockResolvedValue(true);
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'switch "Instance 2"{Enter}');

    await waitFor(() => {
      expect(mockSwitchInstance).toHaveBeenCalledWith('instance-2');
      expect(
        screen.getByText('Switched to instance: Instance 2')
      ).toBeInTheDocument();
    });
  });

  it('lists instances and marks the current one', async () => {
    const user = userEvent.setup();
    mockContext.currentInstanceId = 'instance-2';
    mockContext.currentInstanceName = 'Instance 2';
    mockContext.instances = [
      { id: 'instance-1', name: 'Instance 1' },
      { id: 'instance-2', name: 'Instance 2' }
    ];
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'list-instances{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Instances:')).toBeInTheDocument();
      expect(screen.getByText('Instance 1')).toBeInTheDocument();
      expect(screen.getByText('* Instance 2 (current)')).toBeInTheDocument();
    });
  });

  it('shows error for unknown commands', async () => {
    const user = userEvent.setup();
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'unknown{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Unknown command: unknown')).toBeInTheDocument();
    });
  });

  it('reflects terminal switch in the account switcher selection', async () => {
    const user = userEvent.setup();
    mockContext.isUnlocked = true;
    mockContext.currentInstanceId = 'instance-1';
    mockContext.currentInstanceName = 'Instance 1';
    mockContext.instances = [
      { id: 'instance-1', name: 'Instance 1' },
      { id: 'instance-2', name: 'Instance 2' }
    ];
    mockSwitchInstance.mockImplementation(async (instanceId: string) => {
      const target = mockContext.instances.find(
        (item) => item.id === instanceId
      );
      if (!target) {
        return false;
      }
      mockContext.currentInstanceId = target.id;
      mockContext.currentInstanceName = target.name;
      return true;
    });
    renderConsoleWithAccountSwitcher();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'switch "Instance 2"{Enter}');

    await waitFor(() => {
      expect(mockSwitchInstance).toHaveBeenCalledWith('instance-2');
      expect(
        screen.getByText('Switched to instance: Instance 2')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('account-switcher-button'));

    await waitFor(() => {
      expect(
        screen.getByTestId('instance-unlocked-instance-2')
      ).toBeInTheDocument();
    });
  });
});
