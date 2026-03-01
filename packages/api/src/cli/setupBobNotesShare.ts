import type { Command } from 'commander';
import {
  alice,
  bob,
  createTestUsersDb,
  setupBobNotesShareForAliceDb
} from '@tearleads/shared/scaffolding';
import { buildPostgresConnectionLabel } from '../lib/cliPostgres.js';
import { closePostgresPool, getPostgresPool } from '../lib/postgres.js';

async function runSetupBobNotesShare(): Promise<void> {
  const label = buildPostgresConnectionLabel();
  const pool = await getPostgresPool();

  console.log('Step 1/2: creating or verifying test users...');
  const userClient = await pool.connect();
  try {
    await createTestUsersDb(userClient);
  } finally {
    userClient.release();
  }

  console.log('Step 2/2: creating Bob folder+note and sharing with Alice...');
  const shareClient = await pool.connect();
  try {
    const result = await setupBobNotesShareForAliceDb({
      client: shareClient,
      bobEmail: bob.email,
      aliceEmail: alice.email
    });

    console.log('Done.');
    console.log('  Mode: DB-only (no API required)');
    console.log(`  Root ID: ${result.rootItemId}`);
    console.log(`  Folder ID: ${result.folderId}`);
    console.log(`  Note ID: ${result.noteId}`);
    console.log(`  Share ACL ID: ${result.shareAclId}`);
    console.log(`  Note share ACL ID: ${result.noteShareAclId}`);
    console.log(`  Bob user ID: ${result.bobUserId}`);
    console.log(`  Alice user ID: ${result.aliceUserId}`);
  } finally {
    shareClient.release();
  }

  console.log(`Postgres connection: ${label}`);
}

export function setupBobNotesShareCommand(program: Command): void {
  program
    .command('setup-bob-notes-share')
    .description(
      'Create test users and set up Bob->Alice VFS note sharing'
    )
    .action(async () => {
      let exitCode = 0;
      try {
        await runSetupBobNotesShare();
      } catch (error) {
        exitCode = 1;
        console.error('\nSetup Bob notes share failed:');
        console.error(error instanceof Error ? error.message : String(error));
      } finally {
        await closePostgresPool();
        process.exit(exitCode);
      }
    });
}
