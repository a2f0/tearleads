/**
 * Setup command - Initialize a new encrypted database.
 */

import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import { Command } from 'commander';
import { isDatabaseSetUp, setupDatabase } from '../db/index.js';

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
