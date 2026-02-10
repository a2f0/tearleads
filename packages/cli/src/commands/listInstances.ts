/**
 * list-instances command - Show available database instances.
 */

import { Command } from 'commander';
import {
  hasPersistedSession,
  isDatabaseSetUp,
  isDatabaseUnlocked
} from '../db/index.js';

export async function runListInstances(): Promise<void> {
  const [setUp, sessionPersisted] = await Promise.all([
    isDatabaseSetUp(),
    hasPersistedSession()
  ]);

  const unlocked = isDatabaseUnlocked();

  console.log('Instances:');
  console.log('* Default (current)');
  console.log(`  Setup:             ${setUp ? 'Yes' : 'No'}`);
  console.log(`  Unlocked:          ${unlocked ? 'Yes' : 'No'}`);
  console.log(`  Session persisted: ${sessionPersisted ? 'Yes' : 'No'}`);
}

export const listInstancesCommand = new Command('list-instances')
  .description('List available database instances')
  .action(runListInstances);
