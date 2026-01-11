/**
 * Terminal prompt utilities.
 */

import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';

/**
 * Prompt for password input (hidden).
 */
export async function promptPassword(prompt: string): Promise<string> {
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

/**
 * Prompt for yes/no confirmation.
 */
export async function promptConfirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}
