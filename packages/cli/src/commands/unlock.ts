/**
 * Unlock command - Unlock the database with a password.
 */

import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import { Command } from 'commander';
import { hasPersistedSession } from '../crypto/key-manager.js';
import {
  isDatabaseSetUp,
  isDatabaseUnlocked,
  restoreDatabaseSession,
  unlockDatabase
} from '../db/index.js';

async function promptPassword(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(prompt);
    return await new Promise((resolve) => {
      let input = '';

      if (stdin.isTTY) {
        stdin.setRawMode(true);
      }
      stdin.resume();
      stdin.setEncoding('utf8');

      const onData = (char: string): void => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.removeListener('data', onData);
          if (stdin.isTTY) {
            stdin.setRawMode(false);
          }
          stdout.write('\n');
          resolve(input);
        } else if (char === '\u0003') {
          process.exit(1);
        } else if (char === '\u007F' || char === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
          }
        } else {
          input += char;
        }
      };

      stdin.on('data', onData);
    });
  } finally {
    rl.close();
  }
}

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
