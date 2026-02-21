/**
 * Restore command - Import database from a JSON file.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { decode } from '../backup/index.js';
import { hasPersistedSession } from '../crypto/keyManager.js';
import {
  importBackupDatabase,
  isDatabaseSetUp,
  isDatabaseUnlocked,
  restoreDatabaseSession
} from '../db/index.js';
import { promptConfirm, promptPassword } from '../utils/prompt.js';

interface RestoreOptions {
  force?: boolean;
  password?: string;
}

async function runRestore(
  file: string,
  options: RestoreOptions
): Promise<void> {
  const filePath = path.resolve(file);

  try {
    await fs.access(filePath);
  } catch {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  if (!(await isDatabaseSetUp())) {
    console.error('Database not set up. Run "tearleads setup" first.');
    process.exit(1);
  }

  // Try to restore session if not unlocked
  if (!isDatabaseUnlocked()) {
    if (await hasPersistedSession()) {
      const restored = await restoreDatabaseSession();
      if (!restored) {
        console.error('Session expired. Run "tearleads unlock" first.');
        process.exit(1);
      }
    } else {
      console.error('Database not unlocked. Run "tearleads unlock" first.');
      process.exit(1);
    }
  }

  if (!options.force) {
    const confirmed = await promptConfirm(
      'This will overwrite existing data. Continue? (y/n): '
    );
    if (!confirmed) {
      console.log('Restore cancelled.');
      return;
    }
  }

  const password = options.password
    ? options.password
    : await promptPassword('Backup password: ');

  const backupData = await fs.readFile(filePath);
  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode({ data: new Uint8Array(backupData), password });
  } catch (err) {
    console.error(
      err instanceof Error ? err.message : 'Failed to decode backup file.'
    );
    process.exit(1);
  }

  if (decoded.blobs.length > 0) {
    console.warn(
      `Warning: backup contains ${decoded.blobs.length} blobs that will be ignored in the CLI restore.`
    );
  }

  importBackupDatabase(decoded.database);
  console.log('Database restored successfully.');
}

export const restoreCommand = new Command('restore')
  .description('Import a backup to a new instance')
  .argument('<file>', 'Backup file path')
  .option('-f, --force', 'Overwrite without confirmation')
  .option('-p, --password <password>', 'Backup password')
  .action(runRestore);
