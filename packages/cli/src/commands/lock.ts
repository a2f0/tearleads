/**
 * Lock command - Lock the database and clear session.
 */

import { Command } from 'commander';
import { lockDatabase } from '../db/index.js';

export async function runLock(): Promise<void> {
  await lockDatabase();
  console.log('Database locked.');
}

export const lockCommand = new Command('lock')
  .description('Lock the database')
  .action(runLock);
