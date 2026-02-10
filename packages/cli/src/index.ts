#!/usr/bin/env node

/**
 * Tearleads CLI - Database management for Tearleads.
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { backupCommand } from './commands/backup.js';
import { dumpCommand } from './commands/dump.js';
import { listInstancesCommand } from './commands/listInstances.js';
import { lockCommand } from './commands/lock.js';
import { passwordCommand } from './commands/password.js';
import { restoreCommand } from './commands/restore.js';
import { setupCommand } from './commands/setup.js';
import { unlockCommand } from './commands/unlock.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('tearleads')
  .description('Tearleads CLI for database management')
  .version(pkg.version);

program.addCommand(setupCommand);
program.addCommand(unlockCommand);
program.addCommand(lockCommand);
program.addCommand(backupCommand);
program.addCommand(dumpCommand);
program.addCommand(restoreCommand);
program.addCommand(passwordCommand);
program.addCommand(listInstancesCommand);

program.parse();
