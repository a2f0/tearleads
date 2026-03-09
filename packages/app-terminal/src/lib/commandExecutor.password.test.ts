import { beforeEach, describe, expect, it, vi } from 'vitest';
import { continueCommand, executeCommand } from './commandExecutor';
import { createCommandExecutorTestContext } from './commandExecutor.testSupport';
import { parseCommand } from './commandParser';
import type { PendingCommand } from './types';

describe('command-executor password flow', () => {
  const setupContext = () => createCommandExecutorTestContext();
  let context = setupContext();

  beforeEach(() => {
    context = setupContext();
  });

  describe('password command', () => {
    it('errors if not unlocked', async () => {
      const command = parseCommand('password');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database not unlocked. Unlock first.',
        'error'
      );
    });

    it('starts password change flow', async () => {
      context.db.isUnlocked = true;

      const command = parseCommand('password');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.setPendingCommand).toHaveBeenCalledWith({
        name: 'password',
        step: 'current',
        data: {}
      });
      expect(context.terminal.setPasswordMode).toHaveBeenCalledWith(
        'Current password: '
      );
    });
  });

  describe('password continue', () => {
    it('proceeds through all steps', async () => {
      let pending: PendingCommand = {
        name: 'password',
        step: 'current',
        data: {}
      };

      await continueCommand(
        pending,
        'oldpass',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.setPendingCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          step: 'new',
          data: { current: 'oldpass' }
        })
      );

      pending = {
        name: 'password',
        step: 'new',
        data: { current: 'oldpass' }
      };

      await continueCommand(
        pending,
        'newpass',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.setPendingCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          step: 'confirm',
          data: { current: 'oldpass', new: 'newpass' }
        })
      );

      pending = {
        name: 'password',
        step: 'confirm',
        data: { current: 'oldpass', new: 'newpass' }
      };

      await continueCommand(
        pending,
        'newpass',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.db.changePassword).toHaveBeenCalledWith(
        'oldpass',
        'newpass'
      );
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
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
      expect(context.db.changePassword).not.toHaveBeenCalled();
    });

    it('shows error on incorrect current password', async () => {
      context.db.changePassword = vi.fn().mockResolvedValue(false);

      const pending: PendingCommand = {
        name: 'password',
        step: 'confirm',
        data: { current: 'wrong', new: 'newpass' }
      };

      await continueCommand(
        pending,
        'newpass',
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
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
      expect(context.terminal.setPasswordMode).toHaveBeenCalledWith(
        'Current password: '
      );
    });

    it('shows error for empty new password', async () => {
      const pending: PendingCommand = {
        name: 'password',
        step: 'new',
        data: { current: 'oldpass' }
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
      expect(context.terminal.setPasswordMode).toHaveBeenCalledWith(
        'New password: '
      );
    });
  });
});
