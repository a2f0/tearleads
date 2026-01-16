import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DatabaseOperations,
  FilePicker,
  TerminalControl
} from './command-executor';
import { continueCommand, executeCommand } from './command-executor';
import { parseCommand } from './command-parser';
import type { PendingCommand } from './types';

vi.mock('@/lib/file-utils', () => ({
  generateBackupFilename: vi.fn(() => 'rapid-backup.db'),
  readFileAsUint8Array: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
  saveFile: vi.fn(() => Promise.resolve())
}));

describe('command-executor', () => {
  let db: DatabaseOperations;
  let terminal: TerminalControl;
  let filePicker: FilePicker;

  beforeEach(() => {
    db = {
      isLoading: false,
      isSetUp: false,
      isUnlocked: false,
      hasPersistedSession: false,
      currentInstanceName: 'Default',
      setup: vi.fn().mockResolvedValue(true),
      unlock: vi.fn().mockResolvedValue(true),
      restoreSession: vi.fn().mockResolvedValue(true),
      lock: vi.fn().mockResolvedValue(undefined),
      exportDatabase: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      importDatabase: vi.fn().mockResolvedValue(undefined),
      changePassword: vi.fn().mockResolvedValue(true)
    };

    terminal = {
      appendLine: vi.fn(),
      clearLines: vi.fn(),
      setPasswordMode: vi.fn(),
      setConfirmMode: vi.fn(),
      setCommandMode: vi.fn(),
      setProcessing: vi.fn(),
      setPendingCommand: vi.fn()
    };

    filePicker = {
      pickFile: vi.fn().mockResolvedValue(null)
    };
  });

  describe('help command', () => {
    it('shows available commands', async () => {
      const command = parseCommand('help');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Available commands:',
        'output'
      );
    });

    it('shows help for a specific command', async () => {
      const command = parseCommand('help status');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        'output'
      );
    });

    it('shows error for unknown command', async () => {
      const command = parseCommand('help unknown');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Unknown command: unknown',
        'error'
      );
    });
  });

  describe('status command', () => {
    it('shows database status', async () => {
      db.isSetUp = true;
      db.isUnlocked = false;

      const command = parseCommand('status');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Instance:          Default',
        'output'
      );
      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database:          Locked',
        'output'
      );
    });
  });

  describe('clear command', () => {
    it('clears terminal output', async () => {
      const command = parseCommand('clear');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.clearLines).toHaveBeenCalledTimes(1);
    });
  });

  describe('setup command', () => {
    it('errors if already set up', async () => {
      db.isSetUp = true;

      const command = parseCommand('setup');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database already set up.',
        'error'
      );
    });

    it('starts password prompt flow', async () => {
      const command = parseCommand('setup');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.setPendingCommand).toHaveBeenCalledWith({
        name: 'setup',
        step: 'password',
        data: {}
      });
      expect(terminal.setPasswordMode).toHaveBeenCalledWith('New password: ');
    });
  });

  describe('setup continue', () => {
    it('requires non-empty password', async () => {
      const pending: PendingCommand = {
        name: 'setup',
        step: 'password',
        data: {}
      };

      await continueCommand(pending, '', db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Password cannot be empty.',
        'error'
      );
    });

    it('proceeds to confirm step', async () => {
      const pending: PendingCommand = {
        name: 'setup',
        step: 'password',
        data: {}
      };

      await continueCommand(pending, 'secret123', db, terminal, filePicker);

      expect(terminal.setPendingCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          step: 'confirm',
          data: { password: 'secret123' }
        })
      );
      expect(terminal.setPasswordMode).toHaveBeenCalledWith(
        'Confirm password: '
      );
    });

    it('errors on password mismatch', async () => {
      const pending: PendingCommand = {
        name: 'setup',
        step: 'confirm',
        data: { password: 'secret123' }
      };

      await continueCommand(pending, 'different', db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Passwords do not match.',
        'error'
      );
      expect(terminal.setCommandMode).toHaveBeenCalled();
    });

    it('completes setup successfully', async () => {
      const pending: PendingCommand = {
        name: 'setup',
        step: 'confirm',
        data: { password: 'secret123' }
      };

      await continueCommand(pending, 'secret123', db, terminal, filePicker);

      expect(db.setup).toHaveBeenCalledWith('secret123');
      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database initialized successfully.',
        'success'
      );
    });
  });

  describe('unlock command', () => {
    it('errors if not set up', async () => {
      const command = parseCommand('unlock');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database not set up. Run "setup" first.',
        'error'
      );
    });

    it('informs if already unlocked', async () => {
      db.isSetUp = true;
      db.isUnlocked = true;

      const command = parseCommand('unlock');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database already unlocked.',
        'output'
      );
    });

    it('starts password prompt', async () => {
      db.isSetUp = true;

      const command = parseCommand('unlock');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.setPendingCommand).toHaveBeenCalledWith({
        name: 'unlock',
        step: 'password',
        data: { persist: 'false' }
      });
    });

    it('respects --persist flag', async () => {
      db.isSetUp = true;

      const command = parseCommand('unlock --persist');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.setPendingCommand).toHaveBeenCalledWith({
        name: 'unlock',
        step: 'password',
        data: { persist: 'true' }
      });
    });
  });

  describe('unlock continue', () => {
    it('unlocks with correct password', async () => {
      const pending: PendingCommand = {
        name: 'unlock',
        step: 'password',
        data: { persist: 'false' }
      };

      await continueCommand(pending, 'secret123', db, terminal, filePicker);

      expect(db.unlock).toHaveBeenCalledWith('secret123', false);
      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database unlocked.',
        'success'
      );
    });

    it('unlocks with persist option', async () => {
      const pending: PendingCommand = {
        name: 'unlock',
        step: 'password',
        data: { persist: 'true' }
      };

      await continueCommand(pending, 'secret123', db, terminal, filePicker);

      expect(db.unlock).toHaveBeenCalledWith('secret123', true);
      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database unlocked (session persisted).',
        'success'
      );
    });

    it('shows error on incorrect password', async () => {
      db.unlock = vi.fn().mockResolvedValue(false);

      const pending: PendingCommand = {
        name: 'unlock',
        step: 'password',
        data: { persist: 'false' }
      };

      await continueCommand(pending, 'wrong', db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Incorrect password.',
        'error'
      );
    });
  });

  describe('lock command', () => {
    it('informs if already locked', async () => {
      const command = parseCommand('lock');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database already locked.',
        'output'
      );
    });

    it('locks database', async () => {
      db.isUnlocked = true;

      const command = parseCommand('lock');
      await executeCommand(command, db, terminal, filePicker);

      expect(db.lock).toHaveBeenCalledWith(false);
      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database locked.',
        'success'
      );
    });

    it('locks and clears session with --clear', async () => {
      db.isUnlocked = true;

      const command = parseCommand('lock --clear');
      await executeCommand(command, db, terminal, filePicker);

      expect(db.lock).toHaveBeenCalledWith(true);
      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database locked (session cleared).',
        'success'
      );
    });
  });

  describe('backup command', () => {
    it('errors if not set up', async () => {
      const command = parseCommand('backup');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database not set up. Run "setup" first.',
        'error'
      );
    });

    it('errors if locked without session', async () => {
      db.isSetUp = true;

      const command = parseCommand('backup');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database locked. Unlock first.',
        'error'
      );
    });

    it('exports backup when unlocked', async () => {
      db.isSetUp = true;
      db.isUnlocked = true;

      const command = parseCommand('backup');
      await executeCommand(command, db, terminal, filePicker);

      expect(db.exportDatabase).toHaveBeenCalled();
      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Backup saved as rapid-backup.db.',
        'success'
      );
    });

    it('uses custom filename', async () => {
      db.isSetUp = true;
      db.isUnlocked = true;

      const command = parseCommand('backup mybackup.db');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Backup saved as mybackup.db.',
        'success'
      );
    });

    it('restores session before backup if available', async () => {
      db.isSetUp = true;
      db.hasPersistedSession = true;

      const command = parseCommand('backup');
      await executeCommand(command, db, terminal, filePicker);

      expect(db.restoreSession).toHaveBeenCalled();
      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Session restored.',
        'success'
      );
    });
  });

  describe('restore command', () => {
    it('errors if not set up', async () => {
      const command = parseCommand('restore');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database not set up. Run "setup" first.',
        'error'
      );
    });

    it('cancels if no file selected', async () => {
      db.isSetUp = true;
      filePicker.pickFile = vi.fn().mockResolvedValue(null);

      const command = parseCommand('restore');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Restore cancelled.',
        'output'
      );
    });

    it('errors on non-.db file', async () => {
      db.isSetUp = true;
      filePicker.pickFile = vi.fn().mockResolvedValue({
        name: 'backup.txt'
      });

      const command = parseCommand('restore');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Please select a .db backup file.',
        'error'
      );
    });
  });

  describe('password command', () => {
    it('errors if not unlocked', async () => {
      const command = parseCommand('password');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Database not unlocked. Unlock first.',
        'error'
      );
    });

    it('starts password change flow', async () => {
      db.isUnlocked = true;

      const command = parseCommand('password');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.setPendingCommand).toHaveBeenCalledWith({
        name: 'password',
        step: 'current',
        data: {}
      });
      expect(terminal.setPasswordMode).toHaveBeenCalledWith(
        'Current password: '
      );
    });
  });

  describe('password continue', () => {
    it('proceeds through all steps', async () => {
      // Step 1: current password
      let pending: PendingCommand = {
        name: 'password',
        step: 'current',
        data: {}
      };

      await continueCommand(pending, 'oldpass', db, terminal, filePicker);

      expect(terminal.setPendingCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          step: 'new',
          data: { current: 'oldpass' }
        })
      );

      // Step 2: new password
      pending = {
        name: 'password',
        step: 'new',
        data: { current: 'oldpass' }
      };

      await continueCommand(pending, 'newpass', db, terminal, filePicker);

      expect(terminal.setPendingCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          step: 'confirm',
          data: { current: 'oldpass', new: 'newpass' }
        })
      );

      // Step 3: confirm
      pending = {
        name: 'password',
        step: 'confirm',
        data: { current: 'oldpass', new: 'newpass' }
      };

      await continueCommand(pending, 'newpass', db, terminal, filePicker);

      expect(db.changePassword).toHaveBeenCalledWith('oldpass', 'newpass');
      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Password changed successfully.',
        'success'
      );
    });

    it('errors on password mismatch', async () => {
      const pending: PendingCommand = {
        name: 'password',
        step: 'confirm',
        data: { current: 'oldpass', new: 'newpass' }
      };

      await continueCommand(pending, 'different', db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Passwords do not match.',
        'error'
      );
      expect(db.changePassword).not.toHaveBeenCalled();
    });

    it('shows error on incorrect current password', async () => {
      db.changePassword = vi.fn().mockResolvedValue(false);

      const pending: PendingCommand = {
        name: 'password',
        step: 'confirm',
        data: { current: 'wrong', new: 'newpass' }
      };

      await continueCommand(pending, 'newpass', db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Incorrect current password.',
        'error'
      );
    });

    it('shows error for empty current password', async () => {
      const pending: PendingCommand = {
        name: 'password',
        step: 'current',
        data: {}
      };

      await continueCommand(pending, '', db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Password cannot be empty.',
        'error'
      );
      expect(terminal.setPasswordMode).toHaveBeenCalledWith(
        'Current password: '
      );
    });

    it('shows error for empty new password', async () => {
      const pending: PendingCommand = {
        name: 'password',
        step: 'new',
        data: { current: 'oldpass' }
      };

      await continueCommand(pending, '', db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Password cannot be empty.',
        'error'
      );
      expect(terminal.setPasswordMode).toHaveBeenCalledWith('New password: ');
    });
  });

  describe('unknown command', () => {
    it('shows error for unknown commands', async () => {
      const command = parseCommand('unknown');
      await executeCommand(command, db, terminal, filePicker);

      expect(terminal.appendLine).toHaveBeenCalledWith(
        'Unknown command: unknown',
        'error'
      );
    });

    it('returns false for empty input', async () => {
      const command = parseCommand('');
      const result = await executeCommand(command, db, terminal, filePicker);

      expect(result).toBe(false);
      expect(terminal.appendLine).not.toHaveBeenCalled();
    });
  });
});
