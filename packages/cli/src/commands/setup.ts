/**
 * Setup command - Initialize a new encrypted database.
 */

import { Command } from 'commander';
import { isDatabaseSetUp, setupDatabase } from '../db/index.js';
import { promptPassword } from '../utils/prompt.js';

export async function runSetup(): Promise<void> {
  if (await isDatabaseSetUp()) {
    console.error(
      'Database already set up. Use "tearleads password" to change password.'
    );
    process.exit(1);
  }

  const password = await promptPassword('Enter password: ');
  if (!password) {
    console.error('Password cannot be empty.');
    process.exit(1);
  }

  const confirm = await promptPassword('Confirm password: ');
  if (password !== confirm) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  await setupDatabase(password);
  console.log('Database initialized successfully.');
}

export const setupCommand = new Command('setup')
  .description('Initialize a new encrypted database')
  .action(runSetup);
