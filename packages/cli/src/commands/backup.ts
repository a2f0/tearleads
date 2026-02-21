/**
 * Backup command - Export database to a JSON file.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { encode } from '../backup/index.js';
import type { BackupManifest } from '../backup/types.js';
import { hasPersistedSession } from '../crypto/keyManager.js';
import {
  exportBackupDatabase,
  isDatabaseSetUp,
  isDatabaseUnlocked,
  restoreDatabaseSession
} from '../db/index.js';
import { promptPassword } from '../utils/prompt.js';

interface BackupOptions {
  password?: string;
}

async function resolveBackupPassword(options: BackupOptions): Promise<string> {
  if (options.password) {
    return options.password;
  }

  const password = await promptPassword('Backup password: ');
  const confirm = await promptPassword('Confirm backup password: ');
  if (password !== confirm) {
    console.error('Passwords do not match.');
    process.exit(1);
  }
  return password;
}

async function runBackup(file: string, options: BackupOptions): Promise<void> {
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

  const password = await resolveBackupPassword(options);
  const database = exportBackupDatabase();
  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    platform: 'cli',
    appVersion: 'cli',
    blobCount: 0,
    blobTotalSize: 0
  };

  const data = await encode({
    password,
    manifest,
    database,
    blobs: [],
    readBlob: async () => {
      throw new Error('No blob storage configured for CLI');
    }
  });
  const filePath = path.resolve(file);
  await fs.writeFile(filePath, data);
  console.log(`Backup saved to ${filePath}`);
}

export const backupCommand = new Command('backup')
  .description('Export database to an encrypted .tbu backup file')
  .argument('<file>', 'Output file path')
  .option('-p, --password <password>', 'Backup password')
  .action(runBackup);
