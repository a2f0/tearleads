#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import {
  ensureVfsKeysExist,
  loginApiActor
} from '../../../packages/bob-and-alice/src/scaffolding/apiActorAuth.ts';
import { setupBobNotesShareForAlice } from '../../../packages/bob-and-alice/src/scaffolding/setupBobNotesShareForAlice.ts';
import { runCreateTestUsers } from './createTestUsers.ts';
import { alice, bob } from './testUsers.ts';

const DEFAULT_API_BASE_URL = 'http://localhost:5001/v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseShareCountForTarget(
  value: unknown,
  targetUserId: string
): number {
  if (!isRecord(value) || !Array.isArray(value['shares'])) {
    throw new Error('Unexpected response from /vfs/items/:itemId/shares');
  }

  return value['shares'].filter((share) => {
    if (!isRecord(share)) {
      return false;
    }
    return (
      share['shareType'] === 'user' &&
      typeof share['targetId'] === 'string' &&
      share['targetId'] === targetUserId
    );
  }).length;
}

export async function runCreateBobNotesSharedWithAlice(): Promise<void> {
  const apiBaseUrl = process.env['API_BASE_URL'] ?? DEFAULT_API_BASE_URL;

  console.log('Step 1/4: creating or verifying test users...');
  await runCreateTestUsers();

  console.log('Step 2/4: logging in Bob and Alice...');
  const bobActor = await loginApiActor({
    baseUrl: apiBaseUrl,
    email: bob.email,
    password: bob.password
  });
  const aliceActor = await loginApiActor({
    baseUrl: apiBaseUrl,
    email: alice.email,
    password: alice.password
  });

  console.log('Step 3/4: ensuring VFS keys exist...');
  await ensureVfsKeysExist({ actor: bobActor, keyPrefix: 'bob' });
  await ensureVfsKeysExist({ actor: aliceActor, keyPrefix: 'alice' });

  console.log('Step 4/4: creating Bob folder+note and sharing with Alice...');
  const setupResult = await setupBobNotesShareForAlice({
    bob: bobActor,
    aliceUserId: aliceActor.userId
  });

  const sharesResponse = await bobActor.fetchJson(
    `/vfs/items/${encodeURIComponent(setupResult.folderId)}/shares`
  );
  const matchingShares = parseShareCountForTarget(
    sharesResponse,
    aliceActor.userId
  );

  console.log('Done.');
  console.log(`  API base URL: ${apiBaseUrl}`);
  console.log(`  Folder ID: ${setupResult.folderId}`);
  console.log(`  Note ID: ${setupResult.noteId}`);
  console.log(`  Share ID: ${setupResult.share.id}`);
  console.log(`  Bob user ID: ${bobActor.userId}`);
  console.log(`  Alice user ID: ${aliceActor.userId}`);
  console.log(`  Bob->Alice shares on folder: ${String(matchingShares)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCreateBobNotesSharedWithAlice().catch((error) => {
    console.error('Failed to scaffold Bob->Alice note sharing:', error);
    process.exitCode = 1;
  });
}
