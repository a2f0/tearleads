/**
 * Restore command - Import database from a JSON file.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import { Command } from 'commander';
import { hasPersistedSession } from '../crypto/key-manager.js';
import {
  importDatabase,
  isDatabaseSetUp,
  isDatabaseUnlocked,
  restoreDatabaseSession
} from '../db/index.js';

async function promptConfirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

interface RestoreOptions {
  force?: boolean;
}

export async function runRestore(
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

  const jsonData = await fs.readFile(filePath, 'utf-8');
  await importDatabase(jsonData);
  console.log('Database restored successfully.');
}

export const restoreCommand = new Command('restore')
  .description('Restore database from a backup file')
  .argument('<file>', 'Backup file path')
  .option('-f, --force', 'Overwrite without confirmation')
  .action(runRestore);
