import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand } from './commandExecutor';
import { createCommandExecutorTestContext } from './commandExecutor.testSupport';
import { parseCommand } from './commandParser';

describe('command-executor backup and restore', () => {
  const setupContext = () => createCommandExecutorTestContext();
  let context = setupContext();

  beforeEach(() => {
    context = setupContext();
  });

  describe('backup command', () => {
    it('errors if not set up', async () => {
      const command = parseCommand('backup');
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

    it('errors if locked without session', async () => {
      context.db.isSetUp = true;

      const command = parseCommand('backup');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database locked. Unlock first.',
        'error'
      );
    });

    it('exports backup when unlocked', async () => {
      context.db.isSetUp = true;
      context.db.isUnlocked = true;

      const command = parseCommand('backup');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.db.exportDatabase).toHaveBeenCalled();
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Backup saved as tearleads-backup.db.',
        'success'
      );
    });

    it('uses custom filename', async () => {
      context.db.isSetUp = true;
      context.db.isUnlocked = true;

      const command = parseCommand('backup mybackup.db');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Backup saved as mybackup.db.',
        'success'
      );
    });

    it('restores session before backup if available', async () => {
      context.db.isSetUp = true;
      context.db.hasPersistedSession = true;

      const command = parseCommand('backup');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.db.restoreSession).toHaveBeenCalled();
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Session restored.',
        'success'
      );
    });
  });

  describe('restore command', () => {
    it('errors if not set up', async () => {
      const command = parseCommand('restore');
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

    it('cancels if no file selected', async () => {
      context.db.isSetUp = true;
      context.filePicker.pickFile = vi.fn().mockResolvedValue(null);

      const command = parseCommand('restore');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Restore cancelled.',
        'output'
      );
    });

    it('errors on non-.db file', async () => {
      context.db.isSetUp = true;
      context.filePicker.pickFile = vi.fn().mockResolvedValue({
        name: 'backup.txt'
      });

      const command = parseCommand('restore');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Please select a .db backup file.',
        'error'
      );
    });
  });
});
