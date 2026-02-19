import { beforeEach, describe, expect, it, vi } from 'vitest';
import { continueCommand, executeCommand } from './commandExecutor';
import { parseCommand } from './commandParser';
import { createCommandExecutorTestContext } from './commandExecutor.testSupport';
import type { PendingCommand } from './types';

describe('command-executor setup/unlock/lock flows', () => {
  const setupContext = () => createCommandExecutorTestContext();
  let context = setupContext();

  beforeEach(() => {
    context = setupContext();
  });

  describe('setup command', () => {
    it('errors if already set up', async () => {
      context.db.isSetUp = true;

      const command = parseCommand('setup');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database already set up.',
        'error'
      );
    });

    it('starts password prompt flow', async () => {
      const command = parseCommand('setup');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.setPendingCommand).toHaveBeenCalledWith({
        name: 'setup',
        step: 'password',
        data: {}
      });
      expect(context.terminal.setPasswordMode).toHaveBeenCalledWith(
        'New password: '
      );
    });
  });

  describe('setup continue', () => {
    it('requires non-empty password', async () => {
      const pending: PendingCommand = {
        name: 'setup',
        step: 'password',
        data: {}
      };

      await continueCommand(
        pending,
        '',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
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

      await continueCommand(
        pending,
        'secret123',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.setPendingCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          step: 'confirm',
          data: { password: 'secret123' }
        })
      );
      expect(context.terminal.setPasswordMode).toHaveBeenCalledWith(
        'Confirm password: '
      );
    });

    it('errors on password mismatch', async () => {
      const pending: PendingCommand = {
        name: 'setup',
        step: 'confirm',
        data: { password: 'secret123' }
      };

      await continueCommand(
        pending,
        'different',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Passwords do not match.',
        'error'
      );
      expect(context.terminal.setCommandMode).toHaveBeenCalled();
    });

    it('completes setup successfully', async () => {
      const pending: PendingCommand = {
        name: 'setup',
        step: 'confirm',
        data: { password: 'secret123' }
      };

      await continueCommand(
        pending,
        'secret123',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.db.setup).toHaveBeenCalledWith('secret123');
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database initialized successfully.',
        'success'
      );
    });
  });

  describe('unlock command', () => {
    it('errors if not set up', async () => {
      const command = parseCommand('unlock');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database not set up. Run "setup" first.',
        'error'
      );
    });

    it('informs if already unlocked', async () => {
      context.db.isSetUp = true;
      context.db.isUnlocked = true;

      const command = parseCommand('unlock');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database already unlocked.',
        'output'
      );
    });

    it('starts password prompt', async () => {
      context.db.isSetUp = true;

      const command = parseCommand('unlock');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.setPendingCommand).toHaveBeenCalledWith({
        name: 'unlock',
        step: 'password',
        data: { persist: 'false' }
      });
    });

    it('respects --persist flag', async () => {
      context.db.isSetUp = true;

      const command = parseCommand('unlock --persist');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.setPendingCommand).toHaveBeenCalledWith({
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

      await continueCommand(
        pending,
        'secret123',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.db.unlock).toHaveBeenCalledWith('secret123', false);
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
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

      await continueCommand(
        pending,
        'secret123',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.db.unlock).toHaveBeenCalledWith('secret123', true);
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database unlocked (session persisted).',
        'success'
      );
    });

    it('shows error on incorrect password', async () => {
      context.db.unlock = vi.fn().mockResolvedValue(false);

      const pending: PendingCommand = {
        name: 'unlock',
        step: 'password',
        data: { persist: 'false' }
      };

      await continueCommand(
        pending,
        'wrong',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Incorrect password.',
        'error'
      );
    });
  });

  describe('lock command', () => {
    it('informs if already locked', async () => {
      const command = parseCommand('lock');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database already locked.',
        'output'
      );
    });

    it('locks database', async () => {
      context.db.isUnlocked = true;

      const command = parseCommand('lock');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.db.lock).toHaveBeenCalledWith(false);
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database locked.',
        'success'
      );
    });

    it('locks and clears session with --clear', async () => {
      context.db.isUnlocked = true;

      const command = parseCommand('lock --clear');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.db.lock).toHaveBeenCalledWith(true);
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database locked (session cleared).',
        'success'
      );
    });
  });
});
