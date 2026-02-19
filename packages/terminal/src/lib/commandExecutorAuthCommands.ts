import type {
  DatabaseOperations,
  TerminalControl,
  TerminalUtilities
} from './commandExecutorTypes';
import type { ParsedCommand, PendingCommand } from './types';

export async function startSetup(
  db: DatabaseOperations,
  terminal: TerminalControl
): Promise<void> {
  if (db.isSetUp) {
    terminal.appendLine('Database already set up.', 'error');
    return;
  }

  terminal.setPendingCommand({ name: 'setup', step: 'password', data: {} });
  terminal.setPasswordMode('New password: ');
}

export async function continueSetup(
  pending: PendingCommand,
  input: string,
  db: DatabaseOperations,
  terminal: TerminalControl,
  utilities: TerminalUtilities
): Promise<void> {
  if (pending.step === 'password') {
    if (!input) {
      terminal.appendLine('Password cannot be empty.', 'error');
      terminal.setPasswordMode('New password: ');
      return;
    }

    pending.data['password'] = input;
    pending.step = 'confirm';
    terminal.setPendingCommand({ ...pending });
    terminal.setPasswordMode('Confirm password: ');
    return;
  }

  if (pending.step === 'confirm') {
    if (input !== pending.data['password']) {
      terminal.appendLine('Passwords do not match.', 'error');
      terminal.setPendingCommand(null);
      terminal.setCommandMode();
      return;
    }

    terminal.setProcessing(true);
    terminal.appendLine('Initializing database...', 'output');

    try {
      const success = await db.setup(pending.data['password']);
      if (success) {
        terminal.appendLine('Database initialized successfully.', 'success');
      } else {
        terminal.appendLine('Database setup failed.', 'error');
      }
    } catch (err) {
      terminal.appendLine(
        `Setup failed: ${utilities.getErrorMessage(err)}`,
        'error'
      );
    } finally {
      terminal.setProcessing(false);
      terminal.setPendingCommand(null);
      terminal.setCommandMode();
    }
  }
}

export async function startUnlock(
  command: ParsedCommand,
  db: DatabaseOperations,
  terminal: TerminalControl
): Promise<void> {
  if (!db.isSetUp) {
    terminal.appendLine('Database not set up. Run "setup" first.', 'error');
    return;
  }

  if (db.isUnlocked) {
    terminal.appendLine('Database already unlocked.', 'output');
    return;
  }

  const persist = Boolean(command.flags['persist'] || command.flags['p']);
  terminal.setPendingCommand({
    name: 'unlock',
    step: 'password',
    data: { persist: String(persist) }
  });
  terminal.setPasswordMode('Password: ');
}

export async function continueUnlock(
  pending: PendingCommand,
  input: string,
  db: DatabaseOperations,
  terminal: TerminalControl,
  utilities: TerminalUtilities
): Promise<void> {
  if (!input) {
    terminal.appendLine('Password cannot be empty.', 'error');
    terminal.setPasswordMode('Password: ');
    return;
  }

  terminal.setProcessing(true);
  terminal.appendLine('Unlocking database...', 'output');

  const persist = pending.data['persist'] === 'true';

  try {
    const success = await db.unlock(input, persist);
    if (success) {
      terminal.appendLine(
        persist
          ? 'Database unlocked (session persisted).'
          : 'Database unlocked.',
        'success'
      );
    } else {
      terminal.appendLine('Incorrect password.', 'error');
    }
  } catch (err) {
    terminal.appendLine(
      `Unlock failed: ${utilities.getErrorMessage(err)}`,
      'error'
    );
  } finally {
    terminal.setProcessing(false);
    terminal.setPendingCommand(null);
    terminal.setCommandMode();
  }
}

export async function startPassword(
  db: DatabaseOperations,
  terminal: TerminalControl
): Promise<void> {
  if (!db.isUnlocked) {
    terminal.appendLine('Database not unlocked. Unlock first.', 'error');
    return;
  }

  terminal.setPendingCommand({ name: 'password', step: 'current', data: {} });
  terminal.setPasswordMode('Current password: ');
}

export async function continuePassword(
  pending: PendingCommand,
  input: string,
  db: DatabaseOperations,
  terminal: TerminalControl,
  utilities: TerminalUtilities
): Promise<void> {
  if (pending.step === 'current') {
    if (!input) {
      terminal.appendLine('Password cannot be empty.', 'error');
      terminal.setPasswordMode('Current password: ');
      return;
    }

    pending.data['current'] = input;
    pending.step = 'new';
    terminal.setPendingCommand({ ...pending });
    terminal.setPasswordMode('New password: ');
    return;
  }

  if (pending.step === 'new') {
    if (!input) {
      terminal.appendLine('Password cannot be empty.', 'error');
      terminal.setPasswordMode('New password: ');
      return;
    }

    pending.data['new'] = input;
    pending.step = 'confirm';
    terminal.setPendingCommand({ ...pending });
    terminal.setPasswordMode('Confirm new password: ');
    return;
  }

  if (pending.step === 'confirm') {
    const currentPassword = pending.data['current'] ?? '';
    const newPassword = pending.data['new'] ?? '';

    if (input !== newPassword) {
      terminal.appendLine('Passwords do not match.', 'error');
      terminal.setPendingCommand(null);
      terminal.setCommandMode();
      return;
    }

    terminal.setProcessing(true);
    terminal.appendLine('Changing password...', 'output');

    try {
      const success = await db.changePassword(currentPassword, newPassword);
      if (success) {
        terminal.appendLine('Password changed successfully.', 'success');
      } else {
        terminal.appendLine('Incorrect current password.', 'error');
      }
    } catch (err) {
      terminal.appendLine(
        `Password change failed: ${utilities.getErrorMessage(err)}`,
        'error'
      );
    } finally {
      terminal.setProcessing(false);
      terminal.setPendingCommand(null);
      terminal.setCommandMode();
    }
  }
}
