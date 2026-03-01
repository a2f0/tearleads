#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import { createTestUsersDb } from '../../../packages/shared/src/scaffolding/createTestUsersDb.ts';
import {
  buildConnectionLabel,
  createPool
} from '../../postgres/lib/pool.ts';

export async function runCreateTestUsers(): Promise<void> {
  const pool = await createPool();
  const label = buildConnectionLabel(pool);
  const client = await pool.connect();

  try {
    await createTestUsersDb(client);
    console.log(`Postgres connection: ${label}`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runCreateTestUsers().catch((error) => {
    console.error('Failed to create test users:', error);
    process.exitCode = 1;
  });
}
