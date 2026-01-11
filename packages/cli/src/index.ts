#!/usr/bin/env node
/**
 * Tearleads CLI - Database management for Tearleads.
 */

import { Command } from 'commander';
import { backupCommand } from './commands/backup.js';
import { lockCommand } from './commands/lock.js';
import { passwordCommand } from './commands/password.js';
import { restoreCommand } from './commands/restore.js';
import { setupCommand } from './commands/setup.js';
import { unlockCommand } from './commands/unlock.js';

const program = new Command();

program
  .name('tearleads')
  .description('Tearleads CLI for database management')
  .version('0.0.1');

program.addCommand(setupCommand);
program.addCommand(unlockCommand);
program.addCommand(lockCommand);
program.addCommand(backupCommand);
program.addCommand(restoreCommand);
program.addCommand(passwordCommand);

program.parse();
