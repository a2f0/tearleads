import {
  combinePublicKey,
  generateKeyPair,
  parseConnectJsonEnvelopeBody,
  serializePublicKey,
  type VfsSyncItem,
  type VfsSyncResponse
} from '@tearleads/shared';
import {
  setupBobNotesShareForAliceDb,
  setupWelcomeEmailsDb
} from '@tearleads/shared/scaffolding';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';
import { fetchVfsConnectJson } from '../harness/vfsConnectClient.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEmailIds(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return [];
  }

  const emailsValue = payload['emails'];
  if (!Array.isArray(emailsValue)) {
    return [];
  }

  return emailsValue
    .filter(isRecord)
    .map((entry) => entry['id'])
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

async function fetchEmailIdsFromConnect(
  actor: ReturnType<ApiScenarioHarness['actor']>
): Promise<string[]> {
  const response = await actor.fetch(
    '/connect/tearleads.v1.VfsService/GetEmails',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: 0, limit: 50 })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email fetch failed: ${errorText}`);
  }

  const connectEnvelope: unknown = await response.json();
  const payload = parseConnectJsonEnvelopeBody(connectEnvelope);
  return readEmailIds(payload);
}

async function fetchAllSyncItems(
  actor: ReturnType<ApiScenarioHarness['actor']>
): Promise<VfsSyncItem[]> {
  const all: VfsSyncItem[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await fetchVfsConnectJson<VfsSyncResponse>({
      actor,
      methodName: 'GetSync',
      requestBody: {
        limit: 500,
        cursor
      }
    });
    all.push(...page.items);

    if (!page.hasMore) {
      break;
    }
    if (!page.nextCursor) {
      throw new Error('vfs-sync returned hasMore=true without nextCursor');
    }
    cursor = page.nextCursor;
  }

  return all;
}

function buildPublicEncryptionKey(): string {
  const keyPair = generateKeyPair();
  return combinePublicKey(
    serializePublicKey({
      x25519PublicKey: keyPair.x25519PublicKey,
      mlKemPublicKey: keyPair.mlKemPublicKey
    })
  );
}

function readUpsertName(
  items: VfsSyncItem[],
  itemId: string
): string | undefined {
  const row = items.find(
    (item) => item.itemId === itemId && item.changeType === 'upsert'
  );
  return row?.encryptedName;
}

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

describe('DB scaffolding welcome email visibility', () => {
  let harness: ApiScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('exposes seeded welcome emails to each owner via connect GetEmails', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'bob' }, { alias: 'alice' }],
      getApiDeps
    );

    const bob = harness.actor('bob');
    const alice = harness.actor('alice');

    const client = await harness.ctx.pool.connect();
    let seededEmails: Awaited<ReturnType<typeof setupWelcomeEmailsDb>>;
    try {
      const bobPublicKey = buildPublicEncryptionKey();
      const alicePublicKey = buildPublicEncryptionKey();
      await client.query(
        `INSERT INTO user_keys (
           user_id,
           public_encryption_key,
           public_signing_key,
           encrypted_private_keys,
           argon2_salt,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           public_encryption_key = EXCLUDED.public_encryption_key`,
        [
          bob.user.userId,
          bobPublicKey,
          'seeded-signing-key-bob',
          'seeded-private-keys-bob',
          'seeded-argon2-salt-bob'
        ]
      );
      await client.query(
        `INSERT INTO user_keys (
           user_id,
           public_encryption_key,
           public_signing_key,
           encrypted_private_keys,
           argon2_salt,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           public_encryption_key = EXCLUDED.public_encryption_key`,
        [
          alice.user.userId,
          alicePublicKey,
          'seeded-signing-key-alice',
          'seeded-private-keys-alice',
          'seeded-argon2-salt-alice'
        ]
      );

      await setupBobNotesShareForAliceDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email
      });

      seededEmails = await setupWelcomeEmailsDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email
      });
    } finally {
      client.release();
    }

    const [bobEmailIds, aliceEmailIds, bobSyncItems, aliceSyncItems] =
      await Promise.all([
        fetchEmailIdsFromConnect(bob),
        fetchEmailIdsFromConnect(alice),
        fetchAllSyncItems(bob),
        fetchAllSyncItems(alice)
      ]);

    expect(bobEmailIds).toContain(seededEmails.bob.emailItemId);
    expect(aliceEmailIds).toContain(seededEmails.alice.emailItemId);
    expect(bobEmailIds).not.toContain(seededEmails.alice.emailItemId);
    expect(aliceEmailIds).not.toContain(seededEmails.bob.emailItemId);
    expect(readUpsertName(bobSyncItems, seededEmails.bob.inboxFolderId)).toBe(
      'Inbox'
    );
    expect(
      readUpsertName(aliceSyncItems, seededEmails.alice.inboxFolderId)
    ).toBe('Inbox');
  });
});
