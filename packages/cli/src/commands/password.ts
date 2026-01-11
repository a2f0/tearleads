/**
 * Password command - Change the database password.
 */

import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import { Command } from 'commander';
import { changePassword, isDatabaseSetUp } from '../db/index.js';

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

export async function runPassword(): Promise<void> {
  if (!(await isDatabaseSetUp())) {
    console.error('Database not set up. Run "tearleads setup" first.');
    process.exit(1);
  }

  const oldPassword = await promptPassword('Current password: ');
  const newPassword = await promptPassword('New password: ');

  if (!newPassword) {
    console.error('Password cannot be empty.');
    process.exit(1);
  }

  const confirm = await promptPassword('Confirm new password: ');

  if (newPassword !== confirm) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  const success = await changePassword(oldPassword, newPassword);

  if (!success) {
    console.error('Incorrect current password.');
    process.exit(1);
  }

  console.log('Password changed successfully.');
}

export const passwordCommand = new Command('password')
  .description('Change database password')
  .action(runPassword);
