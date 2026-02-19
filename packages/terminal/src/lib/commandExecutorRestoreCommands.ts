import type { PendingCommand, ParsedCommand } from './types';
import type {
  DatabaseOperations,
  FilePicker,
  TerminalControl,
  TerminalUtilities
} from './commandExecutorTypes';

export async function startRestore(
  command: ParsedCommand,
  db: DatabaseOperations,
  terminal: TerminalControl,
  filePicker: FilePicker,
  utilities: TerminalUtilities
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
    await performRestore(file, db, terminal, utilities);
    return;
  }

  terminal.appendLine(
    `Warning: Restoring from "${file.name}" will overwrite existing data.`,
    'error'
  );

  const data = await utilities.readFileAsUint8Array(file);
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

export async function continueRestore(
  pending: PendingCommand,
  input: string,
  db: DatabaseOperations,
  terminal: TerminalControl,
  utilities: TerminalUtilities
): Promise<void> {
  const normalizedInput = input.toLowerCase().trim();

  if (normalizedInput === 'y' || normalizedInput === 'yes') {
    const base64 = pending.data['fileData'] ?? '';
    const fileName = pending.data['fileName'] ?? 'backup.db';
    const binary = atob(base64);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      data[i] = binary.charCodeAt(i);
    }

    terminal.setPendingCommand(null);
    terminal.setCommandMode();

    await performRestoreFromData(data, fileName, db, terminal, utilities);
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
  terminal: TerminalControl,
  utilities: TerminalUtilities
): Promise<void> {
  terminal.setProcessing(true);
  terminal.appendLine(`Restoring from ${file.name}...`, 'output');

  try {
    const data = await utilities.readFileAsUint8Array(file);
    await db.importDatabase(data);
    await db.lock();
    terminal.appendLine('Database restored successfully.', 'success');
    terminal.appendLine('Please unlock to continue.', 'output');
  } catch (err) {
    terminal.appendLine(
      `Restore failed: ${utilities.getErrorMessage(err)}`,
      'error'
    );
  } finally {
    terminal.setProcessing(false);
  }
}

async function performRestoreFromData(
  data: Uint8Array,
  fileName: string,
  db: DatabaseOperations,
  terminal: TerminalControl,
  utilities: TerminalUtilities
): Promise<void> {
  terminal.setProcessing(true);
  terminal.appendLine(`Restoring from ${fileName}...`, 'output');

  try {
    await db.importDatabase(data);
    await db.lock();
    terminal.appendLine('Database restored successfully.', 'success');
    terminal.appendLine('Please unlock to continue.', 'output');
  } catch (err) {
    terminal.appendLine(
      `Restore failed: ${utilities.getErrorMessage(err)}`,
      'error'
    );
  } finally {
    terminal.setProcessing(false);
  }
}
