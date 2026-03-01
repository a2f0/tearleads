#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import { setupBobNotesShareForAliceDb } from '../../../packages/shared/src/scaffolding/setupBobNotesShareForAliceDb.ts';
import { createPool } from '../../postgres/lib/pool.ts';
import { runCreateTestUsers } from './createTestUsers.ts';
import { alice, bob } from './testUsers.ts';

export async function runCreateBobNotesSharedWithAlice(): Promise<void> {
  console.log('Step 1/2: creating or verifying test users...');
  await runCreateTestUsers();

  console.log('Step 2/2: creating Bob folder+note and sharing with Alice...');
  const pool = await createPool();
  const client = await pool.connect();

  try {
    const result = await setupBobNotesShareForAliceDb({
      client,
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
    client.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCreateBobNotesSharedWithAlice().catch((error) => {
    console.error('Failed to scaffold Bob->Alice note sharing:', error);
    process.exitCode = 1;
  });
}
