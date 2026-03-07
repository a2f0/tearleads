import {
  type createPglitePool as createPglitePoolFn
} from '@tearleads/api-test-utils';
import {
  setupBobNotesShareForAliceDb,
  setupWelcomeEmailsDb
} from '@tearleads/shared/scaffolding';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getApiDeps } from '../harness/getApiDeps.js';
import { getApiTestUtils } from '../harness/getApiTestUtils.js';
import { getDbMigrations } from '../harness/getDbMigrations.js';

describe('DB scaffold schema regression', () => {
  type CreatePglitePool = typeof createPglitePoolFn;
  let pool: Awaited<ReturnType<CreatePglitePool>>['pool'];
  let bobEmail: string;
  let aliceEmail: string;

  beforeAll(async () => {
    const { createPglitePool, createRedisMock, seedTestUser } =
      await getApiTestUtils();
    const { runMigrations } = await getDbMigrations();
    const pglite = await createPglitePool();
    pool = pglite.pool;
    const redis = createRedisMock();
    const { migrations } = await getApiDeps();
    await runMigrations(pool, migrations);

    const bob = await seedTestUser({ pool, redis }, { email: 'bob@test.com' });
    const alice = await seedTestUser(
      { pool, redis },
      { email: 'alice@test.com' }
    );
    bobEmail = bob.email;
    aliceEmail = alice.email;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('setupBobNotesShareForAliceDb succeeds against current schema', async () => {
    const client = await pool.connect();
    try {
      const result = await setupBobNotesShareForAliceDb({
        client,
        bobEmail,
        aliceEmail
      });
      expect(result.bobUserId).toBeTruthy();
      expect(result.aliceUserId).toBeTruthy();
      expect(result.folderId).toBeTruthy();
      expect(result.noteId).toBeTruthy();
      expect(result.shareAclId).toBeTruthy();
      expect(result.noteShareAclId).toBeTruthy();
    } finally {
      client.release();
    }
  });

  it('setupWelcomeEmailsDb succeeds against current schema', async () => {
    const client = await pool.connect();
    try {
      const result = await setupWelcomeEmailsDb({
        client,
        bobEmail,
        aliceEmail
      });
      expect(result.bob.userId).toBeTruthy();
      expect(result.bob.inboxFolderId).toBeTruthy();
      expect(result.bob.emailItemId).toBeTruthy();
      expect(result.alice.userId).toBeTruthy();
      expect(result.alice.inboxFolderId).toBeTruthy();
      expect(result.alice.emailItemId).toBeTruthy();
    } finally {
      client.release();
    }
  });
});
