import type { Command } from 'commander';
import { createTestUsersDb } from '@tearleads/shared/scaffolding';
import { buildPostgresConnectionLabel } from '../lib/cliPostgres.js';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';

async function runCreateTestUsers(): Promise<void> {
  const label = buildPostgresConnectionLabel();
  const pool = await getPostgresPool();
  const client = await pool.connect();

  try {
    await createTestUsersDb(client);
    console.log(`Postgres connection: ${label}`);
  } finally {
    client.release();
  }
}

export function createTestUsersCommand(program: Command): void {
  program
    .command('create-test-users')
    .description('Create Bob and Alice test users with cross-linked orgs')
    .action(async () => {
      let exitCode = 0;
      try {
        await runCreateTestUsers();
      } catch (error) {
        exitCode = 1;
        console.error('\nCreate test users failed:');
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        await closePostgresPool();
        process.exit(exitCode);
      }
    });
}
