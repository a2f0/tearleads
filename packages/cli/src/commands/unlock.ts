/**
 * Unlock command - Unlock the database with a password.
 */

import { Command } from 'commander';
import { hasPersistedSession } from '../crypto/key-manager.js';
import {
  isDatabaseSetUp,
  isDatabaseUnlocked,
  restoreDatabaseSession,
  unlockDatabase
} from '../db/index.js';
import { promptPassword } from '../utils/prompt.js';

export async function runUnlock(): Promise<void> {
  if (!(await isDatabaseSetUp())) {
    console.error('Database not set up. Run "tearleads setup" first.');
    process.exit(1);
  }

  if (isDatabaseUnlocked()) {
    console.log('Database already unlocked.');
    return;
  }

  // Try to restore session first
  if (await hasPersistedSession()) {
    const restored = await restoreDatabaseSession();
    if (restored) {
      console.log('Database unlocked (session restored).');
      return;
    }
  }

  const password = await promptPassword('Enter password: ');
  const success = await unlockDatabase(password);

  if (!success) {
    console.error('Incorrect password.');
    process.exit(1);
  }

  console.log('Database unlocked.');
}

export const unlockCommand = new Command('unlock')
  .description('Unlock the database')
  .action(runUnlock);
