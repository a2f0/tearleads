/**
 * Command execution logic for the virtual terminal.
 * Orchestrates command flows using DatabaseContext operations.
 */

import { getErrorMessage } from '@/lib/errors';
import {
  generateBackupFilename,
  readFileAsUint8Array,
  saveFile
} from '@/lib/file-utils';
import type { ParsedCommand, PendingCommand } from './types';
import { COMMAND_HELP, VALID_COMMANDS } from './types';

/** Database context operations used by the executor */
export interface DatabaseOperations {
  isLoading: boolean;
  isSetUp: boolean;
  isUnlocked: boolean;
  hasPersistedSession: boolean;
  currentInstanceName: string | null;
  setup: (password: string) => Promise<boolean>;
  unlock: (password: string, persistSession?: boolean) => Promise<boolean>;
  restoreSession: () => Promise<boolean>;
  lock: (clearSession?: boolean) => Promise<void>;
  exportDatabase: () => Promise<Uint8Array>;
  importDatabase: (data: Uint8Array) => Promise<void>;
  changePassword: (
    oldPassword: string,
    newPassword: string
  ) => Promise<boolean>;
}

/** Terminal control functions */
export interface TerminalControl {
  appendLine: (
    content: string,
    type: 'command' | 'output' | 'error' | 'success'
  ) => void;
  clearLines: () => void;
  setPasswordMode: (prompt: string) => void;
  setConfirmMode: (prompt: string) => void;
  setCommandMode: () => void;
  setProcessing: (value: boolean) => void;
  setPendingCommand: (command: PendingCommand | null) => void;
}

/** File picker interface for restore command */
export interface FilePicker {
  pickFile: (accept: string) => Promise<File | null>;
}

/**
 * Execute a parsed command.
 * Returns true if the command was handled, false if unknown.
 */
export async function executeCommand(
  command: ParsedCommand,
  db: DatabaseOperations,
  terminal: TerminalControl,
  filePicker: FilePicker
): Promise<boolean> {
  if (!command.name) {
    if (command.raw) {
      terminal.appendLine(
        `Unknown command: ${command.raw.split(' ')[0]}`,
        'error'
      );
      terminal.appendLine('Type "help" for available commands.', 'output');
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
      await executeLock(command, db, terminal);
      return true;

    case 'backup':
      await executeBackup(command, db, terminal);
      return true;

    case 'restore':
      await startRestore(command, db, terminal, filePicker);
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
  filePicker: FilePicker
): Promise<void> {
  switch (pending.name) {
    case 'setup':
      await continueSetup(pending, input, db, terminal);
      break;

    case 'unlock':
      await continueUnlock(pending, input, db, terminal);
      break;

    case 'password':
      await continuePassword(pending, input, db, terminal);
      break;

    case 'restore':
      await continueRestore(pending, input, db, terminal, filePicker);
      break;
  }
}

// ============================================
// Help command
// ============================================

function executeHelp(command: ParsedCommand, terminal: TerminalControl): void {
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

// ============================================
// Status command
// ============================================

function executeStatus(
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

// ============================================
// Setup command
// ============================================

async function startSetup(
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

async function continueSetup(
  pending: PendingCommand,
  input: string,
  db: DatabaseOperations,
  terminal: TerminalControl
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
      terminal.appendLine(`Setup failed: ${getErrorMessage(err)}`, 'error');
    } finally {
      terminal.setProcessing(false);
      terminal.setPendingCommand(null);
      terminal.setCommandMode();
    }
  }
}

// ============================================
// Unlock command
// ============================================

async function startUnlock(
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

async function continueUnlock(
  pending: PendingCommand,
  input: string,
  db: DatabaseOperations,
  terminal: TerminalControl
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
    terminal.appendLine(`Unlock failed: ${getErrorMessage(err)}`, 'error');
  } finally {
    terminal.setProcessing(false);
    terminal.setPendingCommand(null);
    terminal.setCommandMode();
  }
}

// ============================================
// Lock command
// ============================================

async function executeLock(
  command: ParsedCommand,
  db: DatabaseOperations,
  terminal: TerminalControl
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
    terminal.appendLine(`Lock failed: ${getErrorMessage(err)}`, 'error');
  } finally {
    terminal.setProcessing(false);
  }
}

// ============================================
// Backup command
// ============================================

async function executeBackup(
  command: ParsedCommand,
  db: DatabaseOperations,
  terminal: TerminalControl
): Promise<void> {
  // Check if we can proceed (try session restore if needed)
  const canProceed = await ensureUnlocked(db, terminal);
  if (!canProceed) {
    return;
  }

  terminal.setProcessing(true);
  terminal.appendLine('Exporting database...', 'output');

  try {
    const data = await db.exportDatabase();
    const filename = command.args[0] || generateBackupFilename();
    await saveFile(data, filename);
    terminal.appendLine(`Backup saved as ${filename}.`, 'success');
  } catch (err) {
    terminal.appendLine(`Backup failed: ${getErrorMessage(err)}`, 'error');
  } finally {
    terminal.setProcessing(false);
  }
}

// ============================================
// Restore command
// ============================================

async function startRestore(
  command: ParsedCommand,
  db: DatabaseOperations,
  terminal: TerminalControl,
  filePicker: FilePicker
): Promise<void> {
  if (!db.isSetUp) {
    terminal.appendLine('Database not set up. Run "setup" first.', 'error');
    return;
  }

  terminal.appendLine('Select a backup file...', 'output');

  const file = await filePicker.pickFile('.db');
  if (!file) {
    terminal.appendLine('Restore cancelled.', 'output');
    return;
  }

  if (!file.name.endsWith('.db')) {
    terminal.appendLine('Please select a .db backup file.', 'error');
    return;
  }

  const force = Boolean(command.flags['force'] || command.flags['f']);

  if (force) {
    await performRestore(file, db, terminal);
    return;
  }

  // Show confirmation prompt
  terminal.appendLine(
    `Warning: Restoring from "${file.name}" will overwrite existing data.`,
    'error'
  );

  // Store file data as base64 for later use
  // Process in chunks to avoid "Maximum call stack size exceeded" for large files
  const data = await readFileAsUint8Array(file);
  const CHUNK_SIZE = 8192;
  let binaryString = '';
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    binaryString += String.fromCharCode.apply(
      null,
      Array.from(data.subarray(i, i + CHUNK_SIZE))
    );
  }
  const base64 = btoa(binaryString);

  terminal.setPendingCommand({
    name: 'restore',
    step: 'confirm',
    data: { fileName: file.name, fileData: base64 }
  });

  terminal.setConfirmMode('Continue? (y/n): ');
}

async function continueRestore(
  pending: PendingCommand,
  input: string,
  db: DatabaseOperations,
  terminal: TerminalControl,
  _filePicker: FilePicker
): Promise<void> {
  const normalizedInput = input.toLowerCase().trim();

  if (normalizedInput === 'y' || normalizedInput === 'yes') {
    // Restore the file data from base64
    const base64 = pending.data['fileData'] ?? '';
    const fileName = pending.data['fileName'] ?? 'backup.db';
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      data[i] = binary.charCodeAt(i);
    }

    terminal.setPendingCommand(null);
    terminal.setCommandMode();

    await performRestoreFromData(data, fileName, db, terminal);
  } else if (normalizedInput === 'n' || normalizedInput === 'no') {
    terminal.appendLine('Restore cancelled.', 'output');
    terminal.setPendingCommand(null);
    terminal.setCommandMode();
  } else {
    terminal.appendLine('Please enter y or n.', 'output');
    terminal.setConfirmMode('Continue? (y/n): ');
  }
}

async function performRestore(
  file: File,
  db: DatabaseOperations,
  terminal: TerminalControl
): Promise<void> {
  terminal.setProcessing(true);
  terminal.appendLine(`Restoring from ${file.name}...`, 'output');

  try {
    const data = await readFileAsUint8Array(file);
    await db.importDatabase(data);
    await db.lock();
    terminal.appendLine('Database restored successfully.', 'success');
    terminal.appendLine('Please unlock to continue.', 'output');
  } catch (err) {
    terminal.appendLine(`Restore failed: ${getErrorMessage(err)}`, 'error');
  } finally {
    terminal.setProcessing(false);
  }
}

async function performRestoreFromData(
  data: Uint8Array,
  fileName: string,
  db: DatabaseOperations,
  terminal: TerminalControl
): Promise<void> {
  terminal.setProcessing(true);
  terminal.appendLine(`Restoring from ${fileName}...`, 'output');

  try {
    await db.importDatabase(data);
    await db.lock();
    terminal.appendLine('Database restored successfully.', 'success');
    terminal.appendLine('Please unlock to continue.', 'output');
  } catch (err) {
    terminal.appendLine(`Restore failed: ${getErrorMessage(err)}`, 'error');
  } finally {
    terminal.setProcessing(false);
  }
}

// ============================================
// Password command
// ============================================

async function startPassword(
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

async function continuePassword(
  pending: PendingCommand,
  input: string,
  db: DatabaseOperations,
  terminal: TerminalControl
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
        `Password change failed: ${getErrorMessage(err)}`,
        'error'
      );
    } finally {
      terminal.setProcessing(false);
      terminal.setPendingCommand(null);
      terminal.setCommandMode();
    }
  }
}

// ============================================
// Helper functions
// ============================================

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
