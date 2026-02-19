/**
 * Command execution logic for the virtual terminal.
 * Orchestrates command flows using DatabaseContext operations.
 */

import {
  continuePassword,
  continueSetup,
  continueUnlock,
  startPassword,
  startSetup,
  startUnlock
} from './commandExecutorAuthCommands';
import {
  executeBackup,
  executeHelp,
  executeListInstances,
  executeLock,
  executeStatus,
  executeSwitch
} from './commandExecutorCoreCommands';
import {
  continueRestore,
  startRestore
} from './commandExecutorRestoreCommands';
import type {
  DatabaseOperations,
  FilePicker,
  TerminalControl,
  TerminalUtilities
} from './commandExecutorTypes';
import type { ParsedCommand, PendingCommand } from './types';

export type {
  DatabaseOperations,
  FilePicker,
  TerminalControl,
  TerminalUtilities
} from './commandExecutorTypes';

/**
 * Execute a parsed command.
 * Returns true if the command was handled, false if unknown.
 */
export async function executeCommand(
  command: ParsedCommand,
  db: DatabaseOperations,
  terminal: TerminalControl,
  filePicker: FilePicker,
  utilities: TerminalUtilities
): Promise<boolean> {
  if (!command.name) {
    if (command.raw) {
      terminal.appendLine(
        `Unknown command: ${command.raw.split(' ')[0]}`,
        'error'
      );
      terminal.appendLine('Run "help" to list commands.', 'output');
    }
    return false;
  }

  switch (command.name) {
    case 'help':
      executeHelp(command, terminal);
      return true;

    case 'status':
      executeStatus(db, terminal);
      return true;

    case 'list-instances':
      executeListInstances(db, terminal);
      return true;

    case 'clear':
      terminal.clearLines();
      return true;

    case 'setup':
      await startSetup(db, terminal);
      return true;

    case 'unlock':
      await startUnlock(command, db, terminal);
      return true;

    case 'lock':
      await executeLock(command, db, terminal, utilities);
      return true;

    case 'switch':
      await executeSwitch(command, db, terminal, utilities);
      return true;

    case 'backup':
      await executeBackup(command, db, terminal, utilities);
      return true;

    case 'restore':
      await startRestore(command, db, terminal, filePicker, utilities);
      return true;

    case 'password':
      await startPassword(db, terminal);
      return true;

    default:
      return false;
  }
}

/**
 * Continue a multi-step command with user input.
 */
export async function continueCommand(
  pending: PendingCommand,
  input: string,
  db: DatabaseOperations,
  terminal: TerminalControl,
  _filePicker: FilePicker,
  utilities: TerminalUtilities
): Promise<void> {
  switch (pending.name) {
    case 'setup':
      await continueSetup(pending, input, db, terminal, utilities);
      break;

    case 'unlock':
      await continueUnlock(pending, input, db, terminal, utilities);
      break;

    case 'password':
      await continuePassword(pending, input, db, terminal, utilities);
      break;

    case 'restore':
      await continueRestore(pending, input, db, terminal, utilities);
      break;
  }
}
