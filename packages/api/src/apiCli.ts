#!/usr/bin/env -S pnpm tsx
/**
 * Tearleads API CLI
 *
 * A suite of command-line tools for the Tearleads API.
 *
 * Usage:
 *   apiCli.ts <command> [options]
 *
 * Commands:
 *   migrate           Run database migrations
 *   create-account    Create an account in the database
 *   create-test-users Create Bob and Alice test users
 *   delete-account    Delete an account from the database
 *   make-admin        Grant admin privileges to an existing account
 *   list-admins       List accounts with admin privileges
 *   list-users        List all user accounts
 *   setup-bob-notes-share  Create test users and Bob->Alice VFS note sharing
 *   sync-last-active  Sync lastActiveAt from Redis sessions to PostgreSQL
 *   vfs-crdt-compaction  Plan or execute VFS CRDT log compaction
 *   vfs-share-policy-repair  Repair policy-derived VFS ACL drift
 *
 * Environment variables:
 *   NODE_ENV - Set to 'production' for production mode
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE
 *     - Required in production mode
 *   DATABASE_URL or POSTGRES_URL - Alternative connection string (dev mode only)
 */

import { program } from 'commander';
import { createAccountCommand } from './cli/createAccount.js';
import { createTestUsersCommand } from './cli/createTestUsers.js';
import { deleteAccountCommand } from './cli/deleteAccount.js';
import { listAdminsCommand } from './cli/listAdmins.js';
import { listUsersCommand } from './cli/listUsers.js';
import { makeAdminCommand } from './cli/makeAdmin.js';
import { migrateCommand } from './cli/migrate.js';
import { setupBobNotesShareCommand } from './cli/setupBobNotesShare.js';
import { syncLastActiveCommand } from './cli/syncLastActive.js';
import { vfsCrdtCompactionCommand } from './cli/vfsCrdtCompaction.js';
import { vfsSharePolicyRepairCommand } from './cli/vfsSharePolicyRepair.js';

const version = '0.0.1';

program
  .name('apiCli')
  .description('Tearleads API command-line tools')
  .version(version);

// Register commands
migrateCommand(program);
createAccountCommand(program);
createTestUsersCommand(program);
deleteAccountCommand(program);
makeAdminCommand(program);
listAdminsCommand(program);
listUsersCommand(program);
setupBobNotesShareCommand(program);
syncLastActiveCommand(program);
vfsCrdtCompactionCommand(program);
vfsSharePolicyRepairCommand(program);

program.parse();
