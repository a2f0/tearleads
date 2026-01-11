/**
 * Backup command - Export database to a JSON file.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { hasPersistedSession } from '../crypto/key-manager.js';
import {
  exportDatabase,
  isDatabaseSetUp,
  isDatabaseUnlocked,
  restoreDatabaseSession
} from '../db/index.js';

export async function runBackup(file: string): Promise<void> {
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

  const data = exportDatabase();
  const filePath = path.resolve(file);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Backup saved to ${filePath}`);
}

export const backupCommand = new Command('backup')
  .description('Export database to a backup file')
  .argument('<file>', 'Output file path')
  .action(runBackup);
