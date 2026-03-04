#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import { setupBobNotesShareForAliceDb } from '../../../packages/shared/src/scaffolding/setupBobNotesShareForAliceDb.ts';
import { setupBobPhotoAlbumShareForAliceDb } from '../../../packages/shared/src/scaffolding/setupBobPhotoAlbumShareForAliceDb.ts';
import { setupWelcomeEmailsDb } from '../../../packages/shared/src/scaffolding/setupWelcomeEmailsDb.ts';
import { createPool } from '../../postgres/lib/pool.ts';
import { runCreateTestUsers } from './createTestUsers.ts';
import { alice, bob } from './testUsers.ts';

export async function runCreateBobAndAlice(): Promise<void> {
  console.log('Step 1/4: creating or verifying test users...');
  await runCreateTestUsers();

  console.log('Step 2/4: creating Bob folder+note and sharing with Alice...');
  const pool = await createPool();
  const client = await pool.connect();

  try {
    const result = await setupBobNotesShareForAliceDb({
      client,
      bobEmail: bob.email,
      aliceEmail: alice.email
    });

    console.log('  Mode: DB-only (no API required)');
    console.log(`  Root ID: ${result.rootItemId}`);
    console.log(`  Folder ID: ${result.folderId}`);
    console.log(`  Note ID: ${result.noteId}`);
    console.log(`  Share ACL ID: ${result.shareAclId}`);
    console.log(`  Note share ACL ID: ${result.noteShareAclId}`);
    console.log(`  Bob user ID: ${result.bobUserId}`);
    console.log(`  Alice user ID: ${result.aliceUserId}`);

    console.log('Step 3/4: seeding welcome emails for Bob and Alice...');
    const emailResult = await setupWelcomeEmailsDb({
      client,
      bobEmail: bob.email,
      aliceEmail: alice.email
    });

    console.log(`  Bob inbox folder ID: ${emailResult.bob.inboxFolderId}`);
    console.log(`  Bob email item ID: ${emailResult.bob.emailItemId}`);
    console.log(`  Alice inbox folder ID: ${emailResult.alice.inboxFolderId}`);
    console.log(`  Alice email item ID: ${emailResult.alice.emailItemId}`);

    console.log(
      'Step 4/4: creating shared photo album with a scaffolded logo SVG...'
    );
    const photoResult = await setupBobPhotoAlbumShareForAliceDb({
      client,
      bobEmail: bob.email,
      aliceEmail: alice.email
    });

    console.log(`  Shared album ID: ${photoResult.albumId}`);
    console.log(`  Shared photo ID: ${photoResult.photoId}`);
    console.log(`  Album share ACL ID: ${photoResult.albumShareAclId}`);
    console.log(`  Photo share ACL ID: ${photoResult.photoShareAclId}`);

    console.log('Done.');
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCreateBobAndAlice().catch((error) => {
    console.error('Failed to scaffold Bob and Alice:', error);
    process.exitCode = 1;
  });
}
