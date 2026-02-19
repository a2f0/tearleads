import type {
  DatabaseOperations,
  TerminalControl,
  TerminalUtilities
} from './commandExecutorTypes';
import type { ParsedCommand } from './types';
import { COMMAND_HELP, VALID_COMMANDS } from './types';

export function executeHelp(
  command: ParsedCommand,
  terminal: TerminalControl
): void {
  const [subcommand] = command.args;

  if (subcommand) {
    const cmdName = subcommand.toLowerCase();
    if (VALID_COMMANDS.includes(cmdName as (typeof VALID_COMMANDS)[number])) {
      const help = COMMAND_HELP[cmdName as keyof typeof COMMAND_HELP];
      terminal.appendLine(
        `${help.name}${help.args ? ` ${help.args}` : ''}`,
        'output'
      );
      terminal.appendLine(`  ${help.description}`, 'output');
      if (help.flags && help.flags.length > 0) {
        terminal.appendLine('', 'output');
        terminal.appendLine('Flags:', 'output');
        for (const flag of help.flags) {
          terminal.appendLine(`  ${flag}`, 'output');
        }
      }
    } else {
      terminal.appendLine(`Unknown command: ${subcommand}`, 'error');
    }
    return;
  }

  terminal.appendLine('Available commands:', 'output');
  terminal.appendLine('', 'output');
  for (const cmd of VALID_COMMANDS) {
    const help = COMMAND_HELP[cmd];
    terminal.appendLine(`  ${cmd.padEnd(10)} ${help.description}`, 'output');
  }
  terminal.appendLine('', 'output');
  terminal.appendLine('Type "help <command>" for more information.', 'output');
}

export function executeStatus(
  db: DatabaseOperations,
  terminal: TerminalControl
): void {
  const instance = db.currentInstanceName ?? 'Default';
  const dbStatus = db.isLoading
    ? 'Loading...'
    : db.isUnlocked
      ? 'Unlocked'
      : db.isSetUp
        ? 'Locked'
        : 'Not set up';
  const session = db.hasPersistedSession ? 'Yes' : 'No';

  terminal.appendLine(`Instance:          ${instance}`, 'output');
  terminal.appendLine(`Database:          ${dbStatus}`, 'output');
  terminal.appendLine(`Session persisted: ${session}`, 'output');
}

export function executeListInstances(
  db: DatabaseOperations,
  terminal: TerminalControl
): void {
  terminal.appendLine('Instances:', 'output');

  if (!db.instances || db.instances.length === 0) {
    const fallbackName = db.currentInstanceName ?? 'Default';
    terminal.appendLine(`* ${fallbackName} (current)`, 'output');
    return;
  }

  for (const instance of db.instances) {
    const isCurrent = isCurrentInstance(instance, db);
    terminal.appendLine(
      `${isCurrent ? '*' : ' '} ${instance.name}${isCurrent ? ' (current)' : ''}`,
      'output'
    );
  }
}

function isCurrentInstance(
  instance: { id: string; name: string },
  db: DatabaseOperations
): boolean {
  return db.currentInstanceId
    ? instance.id === db.currentInstanceId
    : instance.name === db.currentInstanceName;
}

export async function executeSwitch(
  command: ParsedCommand,
  db: DatabaseOperations,
  terminal: TerminalControl,
  utilities: TerminalUtilities
): Promise<void> {
  if (!db.switchInstance) {
    terminal.appendLine('Instance switching is not available.', 'error');
    return;
  }

  const target = command.args.join(' ').trim();
  if (!target) {
    terminal.appendLine('Usage: switch <instance>', 'error');
    return;
  }

  if (!db.instances || db.instances.length === 0) {
    terminal.appendLine('No instances are available to switch to.', 'error');
    return;
  }

  const targetLower = target.toLowerCase();
  const matched =
    db.instances.find((instance) => instance.id === target) ??
    db.instances.find(
      (instance) => instance.name.toLowerCase() === targetLower
    );

  if (!matched) {
    terminal.appendLine(`Instance not found: ${target}`, 'error');
    terminal.appendLine(
      'Run "list-instances" to see available instances.',
      'output'
    );
    return;
  }

  if (isCurrentInstance(matched, db)) {
    terminal.appendLine(`Already on instance: ${matched.name}`, 'output');
    return;
  }

  terminal.setProcessing(true);
  try {
    const setupComplete = await db.switchInstance(matched.id);
    if (db.refreshInstances) {
      await db.refreshInstances();
    }
    if (setupComplete) {
      terminal.appendLine(`Switched to instance: ${matched.name}`, 'success');
    } else {
      terminal.appendLine(
        `Switched to instance: ${matched.name} (not set up)`,
        'output'
      );
      terminal.appendLine('Run "setup" to initialize this instance.', 'output');
    }
  } catch (err) {
    terminal.appendLine(
      `Failed to switch instance: ${utilities.getErrorMessage(err)}`,
      'error'
    );
  } finally {
    terminal.setProcessing(false);
  }
}

export async function executeLock(
  command: ParsedCommand,
  db: DatabaseOperations,
  terminal: TerminalControl,
  utilities: TerminalUtilities
): Promise<void> {
  if (!db.isUnlocked) {
    terminal.appendLine('Database already locked.', 'output');
    return;
  }

  const clearSession = Boolean(command.flags['clear'] || command.flags['c']);
  terminal.setProcessing(true);
  terminal.appendLine('Locking database...', 'output');

  try {
    await db.lock(clearSession);
    terminal.appendLine(
      clearSession ? 'Database locked (session cleared).' : 'Database locked.',
      'success'
    );
  } catch (err) {
    terminal.appendLine(
      `Lock failed: ${utilities.getErrorMessage(err)}`,
      'error'
    );
  } finally {
    terminal.setProcessing(false);
  }
}

export async function executeBackup(
  command: ParsedCommand,
  db: DatabaseOperations,
  terminal: TerminalControl,
  utilities: TerminalUtilities
): Promise<void> {
  const canProceed = await ensureUnlocked(db, terminal);
  if (!canProceed) {
    return;
  }

  terminal.setProcessing(true);
  terminal.appendLine('Exporting database...', 'output');

  try {
    const data = await db.exportDatabase();
    const filename = command.args[0] || utilities.generateBackupFilename();
    await utilities.saveFile(data, filename);
    terminal.appendLine(`Backup saved as ${filename}.`, 'success');
  } catch (err) {
    terminal.appendLine(
      `Backup failed: ${utilities.getErrorMessage(err)}`,
      'error'
    );
  } finally {
    terminal.setProcessing(false);
  }
}

async function ensureUnlocked(
  db: DatabaseOperations,
  terminal: TerminalControl
): Promise<boolean> {
  if (!db.isSetUp) {
    terminal.appendLine('Database not set up. Run "setup" first.', 'error');
    return false;
  }

  if (db.isUnlocked) {
    return true;
  }

  if (!db.hasPersistedSession) {
    terminal.appendLine('Database locked. Unlock first.', 'error');
    return false;
  }

  terminal.appendLine('Restoring session...', 'output');
  const restored = await db.restoreSession();
  if (!restored) {
    terminal.appendLine('Session expired. Unlock first.', 'error');
    return false;
  }

  terminal.appendLine('Session restored.', 'success');
  return true;
}
