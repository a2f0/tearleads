import { randomUUID } from 'node:crypto';
import {
  buildVfsSharesV2ConnectMethodPath,
  buildVfsV2ConnectMethodPath,
  createConnectJsonPostInit,
  normalizeVfsCrdtSyncConnectPayload,
  parseConnectJsonEnvelopeBody,
  VFS_V2_CONNECT_BASE_PATH,
  type VfsCrdtPushOperation,
  type VfsCrdtPushResponse
} from '@tearleads/shared';
import {
  encodeVfsSyncCursor,
  type VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ApiActorFetchInterceptor,
  createApiActorSyncClient
} from '../harness/apiActorCrdtSync.js';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';
import { ensureVfsKeysExist } from '../harness/ensureVfsKeysExist.js';
import { getApiDeps } from '../harness/getApiDeps.js';
import { fetchVfsConnectJson } from '../harness/vfsConnectClient.js';

type ScenarioActor = ReturnType<ApiScenarioHarness['actor']>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function connectJsonEnvelope(payload: unknown): string {
  return JSON.stringify({ json: JSON.stringify(payload) });
}

function unwrapConnectPayload(payload: unknown): unknown {
  let current = parseConnectJsonEnvelopeBody(payload);
  let unwrapDepth = 0;

  while (
    isRecord(current) &&
    'result' in current &&
    current['result'] !== undefined
  ) {
    if (unwrapDepth >= 8) {
      throw new Error('transport returned cyclic connect result wrapper');
    }

    current = parseConnectJsonEnvelopeBody(current['result']);
    unwrapDepth += 1;
  }

  return current;
}

async function fetchRawCrdtSyncPage(input: {
  actor: ScenarioActor;
  requestBody: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const envelope = await input.actor.fetchJson<unknown>(
    buildVfsV2ConnectMethodPath('GetCrdtSync'),
    createConnectJsonPostInit(input.requestBody)
  );
  const payload = unwrapConnectPayload(envelope);
  if (!isRecord(payload)) {
    throw new Error('expected GetCrdtSync to return an object payload');
  }

  return payload;
}

function buildItemUpsertOperation(input: {
  opId: string;
  itemId: string;
  replicaId: string;
  writeId: number;
  occurredAt: string;
  plaintext: string;
}): VfsCrdtPushOperation {
  return {
    opId: input.opId,
    opType: 'item_upsert',
    itemId: input.itemId,
    replicaId: input.replicaId,
    writeId: input.writeId,
    occurredAt: input.occurredAt,
    encryptedPayload: toBase64(input.plaintext),
    keyEpoch: 1,
    encryptionNonce: toBase64(`nonce-${input.opId}`),
    encryptionAad: toBase64(`aad-${input.opId}`),
    encryptionSignature: toBase64(`sig-${input.opId}`)
  };
}

function readConnectCursor(init?: RequestInit): string | null {
  if (typeof init?.body !== 'string') {
    return null;
  }

  const parsed = JSON.parse(init.body);
  if (!isRecord(parsed)) {
    return null;
  }

  const cursor = parsed['cursor'];
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : null;
}

describe('shared note edit sync incremental cursor guardrail', () => {
  let harness: ApiScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('tolerates one stale CRDT replay page without failing closed', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'bob' }, { alias: 'alice' }],
      getApiDeps
    );

    const bob = harness.actor('bob');
    const alice = harness.actor('alice');

    const sharedOrgId = `${randomUUID()}`;
    await harness.ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, 'Shared Org', NOW(), NOW())`,
      [sharedOrgId]
    );
    await harness.ctx.pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
       VALUES ($1, $2, NOW()), ($3, $2, NOW())`,
      [bob.user.userId, sharedOrgId, alice.user.userId]
    );

    await ensureVfsKeysExist({
      ctx: harness.ctx,
      actor: bob,
      keyPrefix: 'bob-incremental'
    });
    await ensureVfsKeysExist({
      ctx: harness.ctx,
      actor: alice,
      keyPrefix: 'alice-incremental'
    });

    const noteId = `${randomUUID()}`;
    await bob.fetchJson(buildVfsV2ConnectMethodPath('Register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: noteId,
        objectType: 'note',
        encryptedSessionKey: 'bob-session-key',
        encryptedName: 'Shared note from Bob'
      })
    });

    await bob.fetchJson(buildVfsSharesV2ConnectMethodPath('CreateShare'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: noteId,
        shareType: 'user',
        targetId: alice.user.userId,
        permissionLevel: 'edit',
        wrappedKey: {
          recipientUserId: alice.user.userId,
          recipientPublicKeyId: 'alice-public-key-id',
          keyEpoch: 1,
          encryptedKey: 'wrapped-key-for-alice',
          senderSignature: 'bob-signature'
        }
      })
    });

    const baseOccurredAtMs = Date.parse('2026-03-09T12:00:00.000Z');
    const bobPushOperation = buildItemUpsertOperation({
      opId: `bob-op-${randomUUID()}`,
      itemId: noteId,
      replicaId: 'bob-client',
      writeId: 1,
      occurredAt: new Date(baseOccurredAtMs).toISOString(),
      plaintext: 'bob-seed'
    });
    const bobPush = await fetchVfsConnectJson<VfsCrdtPushResponse>({
      actor: bob,
      methodName: 'PushCrdtOps',
      requestBody: {
        clientId: 'bob-client',
        operations: [bobPushOperation]
      }
    });
    expect(bobPush.results[0]?.status).toBe('applied');

    let staleCursor: VfsSyncCursor | null = null;
    let staleItem: Record<string, unknown> | null = null;
    let staleLastWriteIdsPayload: Record<string, unknown> | null = null;
    let staleReplayCount = 0;
    const injectStaleReplay: ApiActorFetchInterceptor = async ({
      path,
      init,
      proceed
    }) => {
      if (
        !path.endsWith(`${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`) ||
        !staleCursor ||
        !staleItem ||
        !staleLastWriteIdsPayload ||
        staleReplayCount > 0
      ) {
        return proceed();
      }

      const requestCursor = readConnectCursor(init);
      const encodedRequestCursor = encodeVfsSyncCursor(staleCursor);
      if (requestCursor !== encodedRequestCursor) {
        return proceed();
      }

      staleReplayCount += 1;
      return new Response(
        connectJsonEnvelope({
          items: [staleItem],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: staleLastWriteIdsPayload
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    };

    const bobSyncClient = createApiActorSyncClient({
      actor: bob,
      clientId: 'bob-http-sync',
      intercept: injectStaleReplay,
      includeReconcileState: false,
      clientOptions: {
        pullLimit: 50
      }
    });

    const seedSync = await bobSyncClient.sync();
    expect(seedSync.pulledOperations).toBeGreaterThan(0);

    staleCursor = bobSyncClient.snapshot().cursor;
    if (!staleCursor) {
      throw new Error('expected Bob cursor after seed sync');
    }

    const stalePage = await fetchRawCrdtSyncPage({
      actor: bob,
      requestBody: {
        limit: 200
      }
    });
    const stalePageItems = stalePage['items'];
    if (!Array.isArray(stalePageItems)) {
      throw new Error('expected GetCrdtSync to return an items array');
    }
    const rawStaleLastWriteIds = stalePage['lastReconciledWriteIds'];
    if (!isRecord(rawStaleLastWriteIds)) {
      throw new Error(
        'expected GetCrdtSync to return a lastReconciledWriteIds object'
      );
    }
    staleLastWriteIdsPayload = rawStaleLastWriteIds;
    const normalizedStalePage = normalizeVfsCrdtSyncConnectPayload(stalePage);
    const staleItemIndex = normalizedStalePage.items.findIndex(
      (item) => item.opId === staleCursor.changeId
    );
    const rawStaleItem =
      staleItemIndex >= 0 ? stalePageItems[staleItemIndex] : null;
    staleItem = isRecord(rawStaleItem) ? rawStaleItem : null;
    if (!staleItem) {
      throw new Error('expected to find Bob cursor item in CRDT feed');
    }

    const alicePushOperation = buildItemUpsertOperation({
      opId: `alice-op-${randomUUID()}`,
      itemId: noteId,
      replicaId: 'alice-client',
      writeId: 1,
      occurredAt: new Date(baseOccurredAtMs + 1_000).toISOString(),
      plaintext: 'alice-edit-v2'
    });
    const alicePush = await fetchVfsConnectJson<VfsCrdtPushResponse>({
      actor: alice,
      methodName: 'PushCrdtOps',
      requestBody: {
        clientId: 'alice-client',
        operations: [alicePushOperation]
      }
    });
    expect(alicePush.results[0]?.status).toBe('applied');

    const stateBeforeStalePull = bobSyncClient.exportState();
    const stalePullResult = await bobSyncClient.sync();
    expect(stalePullResult).toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    expect(staleReplayCount).toBe(1);
    expect(bobSyncClient.exportState()).toEqual(stateBeforeStalePull);
  });
});
