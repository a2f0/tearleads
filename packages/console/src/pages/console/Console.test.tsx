import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mockContext,
  mockExportDatabase,
  mockLock,
  mockRestoreSession,
  mockSaveFile,
  mockSetup,
  mockUnlock,
  renderConsole,
  resetConsoleTestState
} from './Console.testHelpers';

describe('Console', () => {
  beforeEach(() => {
    resetConsoleTestState();
  });

  it('renders the console title', () => {
    renderConsole();

    expect(screen.getByText('Console')).toBeInTheDocument();
  });

  it('shows back link by default', () => {
    renderConsole();

    expect(screen.getByTestId('back-link')).toBeInTheDocument();
  });

  it('renders the terminal component', () => {
    renderConsole();

    expect(screen.getByTestId('terminal')).toBeInTheDocument();
  });

  it('does not show terminal welcome banner text', () => {
    renderConsole();
    expect(screen.queryByText('Tearleads Terminal')).not.toBeInTheDocument();
  });

  it('runs setup command when passwords match', async () => {
    const user = userEvent.setup();
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'setup{Enter}');

    // Enter password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'testpass123{Enter}');

    // Confirm password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'testpass123{Enter}');

    await waitFor(() => {
      expect(mockSetup).toHaveBeenCalledWith('testpass123');
    });
  });

  it('logs when setup is already complete', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'setup{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Database already set up.')).toBeInTheDocument();
    });
  });

  it('logs when setup passwords do not match', async () => {
    const user = userEvent.setup();
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'setup{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'testpass123{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'mismatch{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    });
  });

  it('logs when setup fails', async () => {
    const user = userEvent.setup();
    mockSetup.mockResolvedValue(false);
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'setup{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'testpass123{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'testpass123{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Database setup failed.')).toBeInTheDocument();
    });
  });

  it('shows error when unlock is attempted on non-setup database', async () => {
    const user = userEvent.setup();
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'unlock{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Database not set up. Run "setup" first.')
      ).toBeInTheDocument();
    });
  });

  it('exports a backup when unlocked', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'backup{Enter}');

    await waitFor(() => {
      expect(mockExportDatabase).toHaveBeenCalledTimes(1);
    });
    expect(mockSaveFile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      'tearleads-backup.db'
    );
  });

  it('logs when unlock fails with incorrect password', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockUnlock.mockResolvedValue(false);
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'unlock{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'wrongpass{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Incorrect password.')).toBeInTheDocument();
    });
  });

  it('logs when unlock fails with error', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockUnlock.mockRejectedValue(new Error('Unlock exploded'));
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'unlock{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'testpass123{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Unlock failed: Unlock exploded')
      ).toBeInTheDocument();
    });
  });

  it('unlocks the database with persisted session', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'unlock --persist{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'testpass123{Enter}');

    await waitFor(() => {
      expect(mockUnlock).toHaveBeenCalledWith('testpass123', true);
    });
    expect(
      screen.getByText('Database unlocked (session persisted).')
    ).toBeInTheDocument();
  });

  it('logs when backup requested while locked', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    mockContext.hasPersistedSession = false;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'backup{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Database locked. Unlock first.')
      ).toBeInTheDocument();
    });
  });

  it('logs when backup fails', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockExportDatabase.mockRejectedValue(new Error('Backup exploded'));
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'backup{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Backup failed: Backup exploded')
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

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'backup{Enter}');

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

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'backup{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Session expired. Unlock first.')
      ).toBeInTheDocument();
    });
  });

  it('logs when lock clears the persisted session', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockContext.hasPersistedSession = true;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'lock --clear{Enter}');

    await waitFor(() => {
      expect(mockLock).toHaveBeenCalledWith(true);
    });
    expect(
      screen.getByText('Database locked (session cleared).')
    ).toBeInTheDocument();
  });

  it('logs when lock fails', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockLock.mockRejectedValue(new Error('Lock exploded'));
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'lock{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Lock failed: Lock exploded')
      ).toBeInTheDocument();
    });
  });

  it('locks without clearing session', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'lock{Enter}');

    await waitFor(() => {
      expect(mockLock).toHaveBeenCalledWith(false);
    });
    expect(screen.getByText('Database locked.')).toBeInTheDocument();
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
});
