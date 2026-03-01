#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import { setupBobNotesShareForAliceDb } from '../../../packages/bob-and-alice/src/scaffolding/setupBobNotesShareForAliceDb.ts';
import { createPool } from '../../postgres/lib/pool.ts';
import { runCreateTestUsers } from './createTestUsers.ts';
import { alice, bob } from './testUsers.ts';

export async function runCreateBobNotesSharedWithAlice(): Promise<void> {
  console.log('Step 1/4: creating or verifying test users...');
  await runCreateTestUsers();

  console.log('Step 2/2: creating Bob folder+note and sharing with Alice...');
  const pool = await createPool();
  const client = await pool.connect();
  let setupResult:
    | Awaited<ReturnType<typeof setupBobNotesShareForAliceDb>>
    | undefined;

  try {
    setupResult = await setupBobNotesShareForAliceDb({
      client,
      bobEmail: bob.email,
      aliceEmail: alice.email
    });
  } finally {
    client.release();
    await pool.end();
  }

  if (!setupResult) {
    throw new Error('Failed to produce setup result');
  }

  console.log('Done.');
  console.log('  Mode: DB-only (no API required)');
  console.log(`  Root ID: ${setupResult.rootItemId}`);
  console.log(`  Folder ID: ${setupResult.folderId}`);
  console.log(`  Note ID: ${setupResult.noteId}`);
  console.log(`  Share ACL ID: ${setupResult.shareAclId}`);
  console.log(`  Bob user ID: ${setupResult.bobUserId}`);
  console.log(`  Alice user ID: ${setupResult.aliceUserId}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCreateBobNotesSharedWithAlice().catch((error) => {
    console.error('Failed to scaffold Bob->Alice note sharing:', error);
    process.exitCode = 1;
  });
}
