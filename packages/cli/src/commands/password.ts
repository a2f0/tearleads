/**
 * Password command - Change the database password.
 */

import { Command } from 'commander';
import { changePassword, isDatabaseSetUp } from '../db/index.js';
import { promptPassword } from '../utils/prompt.js';

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
