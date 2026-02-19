import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand } from './commandExecutor';
import { parseCommand } from './commandParser';
import { createCommandExecutorTestContext } from './commandExecutor.testSupport';

describe('command-executor general commands', () => {
  const setupContext = () => createCommandExecutorTestContext();
  let context = setupContext();

  beforeEach(() => {
    context = setupContext();
  });

  describe('help command', () => {
    it('shows available commands', async () => {
      const command = parseCommand('help');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Available commands:',
        'output'
      );
    });

    it('shows help for a specific command', async () => {
      const command = parseCommand('help status');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('status'),
        'output'
      );
    });

    it('shows error for unknown command', async () => {
      const command = parseCommand('help unknown');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Unknown command: unknown',
        'error'
      );
    });
  });

  describe('status command', () => {
    it('shows database status', async () => {
      context.db.isSetUp = true;
      context.db.isUnlocked = false;

      const command = parseCommand('status');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Instance:          Default',
        'output'
      );
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Database:          Locked',
        'output'
      );
    });
  });

  describe('list-instances command', () => {
    it('lists all instances and marks current', async () => {
      context.db.currentInstanceId = 'instance-2';
      context.db.currentInstanceName = 'Instance 2';
      context.db.instances = [
        { id: 'instance-1', name: 'Instance 1' },
        { id: 'instance-2', name: 'Instance 2' }
      ];

      const command = parseCommand('list-instances');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Instances:',
        'output'
      );
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        '  Instance 1',
        'output'
      );
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        '* Instance 2 (current)',
        'output'
      );
    });

    it('falls back to current instance name when instances are unavailable', async () => {
      context.db.instances = undefined;
      context.db.currentInstanceName = 'Default';

      const command = parseCommand('list-instances');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Instances:',
        'output'
      );
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        '* Default (current)',
        'output'
      );
    });
  });

  describe('switch command', () => {
    it('switches to a target instance by name', async () => {
      context.db.currentInstanceId = 'instance-1';
      context.db.currentInstanceName = 'Instance 1';
      context.db.instances = [
        { id: 'instance-1', name: 'Instance 1' },
        { id: 'instance-2', name: 'Instance 2' }
      ];

      const command = parseCommand('switch "Instance 2"');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.db.switchInstance).toHaveBeenCalledWith('instance-2');
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Switched to instance: Instance 2',
        'success'
      );
    });

    it('shows usage when no target is provided', async () => {
      const command = parseCommand('switch');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Usage: switch <instance>',
        'error'
      );
    });

    it('shows error for unknown instance', async () => {
      context.db.instances = [{ id: 'instance-1', name: 'Instance 1' }];

      const command = parseCommand('switch does-not-exist');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Instance not found: does-not-exist',
        'error'
      );
    });

    it('errors when instance switching is unavailable', async () => {
      context.db.switchInstance = undefined;
      context.db.instances = [{ id: 'instance-1', name: 'Instance 1' }];

      const command = parseCommand('switch Instance 1');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Instance switching is not available.',
        'error'
      );
    });

    it('errors when no instances are available', async () => {
      context.db.instances = [];

      const command = parseCommand('switch Instance 1');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'No instances are available to switch to.',
        'error'
      );
    });

    it('reports when already on the target instance', async () => {
      context.db.currentInstanceId = 'instance-1';
      context.db.currentInstanceName = 'Instance 1';
      context.db.instances = [{ id: 'instance-1', name: 'Instance 1' }];

      const command = parseCommand('switch instance-1');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Already on instance: Instance 1',
        'output'
      );
    });

    it('shows setup guidance when switched to a non-setup instance', async () => {
      context.db.currentInstanceId = 'instance-1';
      context.db.instances = [
        { id: 'instance-1', name: 'Instance 1' },
        { id: 'instance-2', name: 'Instance 2' }
      ];
      context.db.switchInstance = vi.fn().mockResolvedValue(false);

      const command = parseCommand('switch instance-2');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Switched to instance: Instance 2 (not set up)',
        'output'
      );
      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Run "setup" to initialize this instance.',
        'output'
      );
    });

    it('shows error when switching throws', async () => {
      context.db.currentInstanceId = 'instance-1';
      context.db.instances = [
        { id: 'instance-1', name: 'Instance 1' },
        { id: 'instance-2', name: 'Instance 2' }
      ];
      context.db.switchInstance = vi.fn().mockRejectedValue(new Error('boom'));

      const command = parseCommand('switch instance-2');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Failed to switch instance: boom',
        'error'
      );
    });
  });

  describe('clear command', () => {
    it('clears terminal output', async () => {
      const command = parseCommand('clear');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.clearLines).toHaveBeenCalledTimes(1);
    });
  });

  describe('unknown command', () => {
    it('shows error for unknown commands', async () => {
      const command = parseCommand('unknown');
      await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(context.terminal.appendLine).toHaveBeenCalledWith(
        'Unknown command: unknown',
        'error'
      );
    });

    it('returns false for empty input', async () => {
      const command = parseCommand('');
      const result = await executeCommand(
        command,
        context.db,
        context.terminal,
        context.filePicker,
        context.utilities
      );

      expect(result).toBe(false);
      expect(context.terminal.appendLine).not.toHaveBeenCalled();
    });
  });
});
