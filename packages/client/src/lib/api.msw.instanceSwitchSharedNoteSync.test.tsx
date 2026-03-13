import '../test/setupIntegration';

import { randomUUID } from 'node:crypto';
import { seedTestUser } from '@tearleads/api-test-utils';
import type { VfsCrdtSyncResponse } from '@tearleads/shared';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '@tearleads/shared';
import { setupBobNotesShareForAliceDb } from '@tearleads/shared/scaffolding';
import { render, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthInstanceBinding } from '@/components/AuthInstanceBinding';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { DatabaseProvider, useDatabaseContext } from '@/db/hooks';
import { clearStoredAuth, storeAuth } from '@/lib/authStorage';
import { getSharedTestContext } from '@/test/testContext';
import {
  installVfsConsoleGuard,
  type VfsConsoleGuard
} from '@/test/vfsConsoleGuard';
import { fetchVfsConnectJson } from '../../../bob-and-alice/src/harness/vfsConnectClient';
import type { JsonApiActor } from '../../../bob-and-alice/src/scaffolding/setupBobNotesShareForAlice';

const TEST_TIMEOUT_MS = 45000;

interface AuthSnapshot {
  id: string;
  email: string;
}

let latestAuthContext: ReturnType<typeof useAuth> | null = null;
let latestDatabaseContext: ReturnType<typeof useDatabaseContext> | null = null;
let vfsConsoleGuard: VfsConsoleGuard | null = null;
const mockApiLogout = vi.fn(async () => undefined);

vi.mock('@/lib/api', () => ({
  api: {
    auth: {
      login: vi.fn(),
      register: vi.fn(),
      logout: () => mockApiLogout()
    },
    vfs: {
      getSync: vi.fn(),
      getCrdtSync: vi.fn()
    }
  },
  tryRefreshToken: vi.fn(async () => false)
}));

function AuthContextProbe() {
  latestAuthContext = useAuth();
  return null;
}

function DatabaseContextProbe() {
  latestDatabaseContext = useDatabaseContext();
  return null;
}

function requireAuthContext(): ReturnType<typeof useAuth> {
  if (!latestAuthContext) {
    throw new Error('Expected auth context to be available');
  }
  return latestAuthContext;
}

function requireDatabaseContext(): ReturnType<typeof useDatabaseContext> {
  if (!latestDatabaseContext) {
    throw new Error('Expected database context to be available');
  }
  return latestDatabaseContext;
}

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
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

async function seedUserKeys(input: {
  client: {
    query: (text: string, params?: readonly unknown[]) => Promise<unknown>;
  };
  bobUserId: string;
  aliceUserId: string;
}): Promise<void> {
  const bobPublicKey = buildPublicEncryptionKey();
  const alicePublicKey = buildPublicEncryptionKey();

  await input.client.query(
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
      input.bobUserId,
      bobPublicKey,
      'seeded-signing-key-bob',
      'seeded-private-keys-bob',
      'seeded-argon2-salt-bob'
    ]
  );

  await input.client.query(
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
      input.aliceUserId,
      alicePublicKey,
      'seeded-signing-key-alice',
      'seeded-private-keys-alice',
      'seeded-argon2-salt-alice'
    ]
  );
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (raw.trim().length === 0) {
    return null;
  }
  return JSON.parse(raw);
}

function createTokenActor(input: {
  baseUrl: string;
  resolveToken: () => string | null;
}): JsonApiActor {
  return {
    async fetchJson(path: string, init?: RequestInit): Promise<unknown> {
      const token = input.resolveToken();
      if (!token) {
        throw new Error('Missing auth token');
      }

      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(`${input.baseUrl}${path}`, {
        ...init,
        headers
      });
      const body = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(
          `Request failed: ${path} ${String(response.status)} ${JSON.stringify(body)}`
        );
      }
      return body;
    }
  };
}

async function waitForProvidersReady(): Promise<void> {
  await waitFor(() => {
    expect(latestAuthContext).not.toBeNull();
    expect(latestDatabaseContext).not.toBeNull();
    expect(latestAuthContext?.isLoading).toBe(false);
    expect(latestDatabaseContext?.isLoading).toBe(false);
    expect(latestDatabaseContext?.currentInstanceId).toBeTruthy();
  });
}

async function waitForAuthUser(userId: string): Promise<void> {
  await waitFor(() => {
    const auth = requireAuthContext();
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.user?.id).toBe(userId);
  });
}

async function waitForCurrentInstanceBoundTo(userId: string): Promise<void> {
  await waitFor(() => {
    const database = requireDatabaseContext();
    const currentInstance = database.instances.find(
      (instance) => instance.id === database.currentInstanceId
    );
    expect(currentInstance?.boundUserId).toBe(userId);
  });
}

async function waitForCurrentInstance(instanceId: string): Promise<void> {
  await waitFor(() => {
    const database = requireDatabaseContext();
    expect(database.currentInstanceId).toBe(instanceId);
    expect(database.isLoading).toBe(false);
  });
}

describe('instance switch shared-note sync regression', () => {
  beforeEach(() => {
    vfsConsoleGuard = installVfsConsoleGuard();
    latestAuthContext = null;
    latestDatabaseContext = null;
    clearStoredAuth();
    mockApiLogout.mockClear();
  });

  afterEach(async () => {
    if (!vfsConsoleGuard) {
      return;
    }
    try {
      await vfsConsoleGuard.assertNoRegressions({ gracePeriodMs: 25 });
    } finally {
      vfsConsoleGuard.restore();
      vfsConsoleGuard = null;
    }
  });

  it(
    'keeps Bob authenticated and able to sync Alice note update after switching back to Bob instance',
    async () => {
      const ctx = getSharedTestContext();
      const apiBaseUrl = `${ctx.baseUrl}/v1`;

      const bob = await seedTestUser(ctx, {
        email: 'bob-instance-switch@test.local'
      });
      const alice = await seedTestUser(ctx, {
        email: 'alice-instance-switch@test.local'
      });

      const bobAuth: AuthSnapshot = { id: bob.userId, email: bob.email };
      const aliceAuth: AuthSnapshot = { id: alice.userId, email: alice.email };

      const client = await ctx.pool.connect();
      let seededShare: Awaited<ReturnType<typeof setupBobNotesShareForAliceDb>>;
      try {
        await seedUserKeys({
          client,
          bobUserId: bob.userId,
          aliceUserId: alice.userId
        });
        seededShare = await setupBobNotesShareForAliceDb({
          client,
          bobEmail: bob.email,
          aliceEmail: alice.email,
          shareAccessLevel: 'write'
        });
      } finally {
        client.release();
      }

      render(
        <DatabaseProvider>
          <AuthProvider>
            <AuthInstanceBinding />
            <DatabaseContextProbe />
            <AuthContextProbe />
          </AuthProvider>
        </DatabaseProvider>
      );

      await waitForProvidersReady();

      await act(async () => {
        storeAuth(bob.accessToken, bob.refreshToken, bobAuth, {
          persistToken: false
        });
      });
      await waitForAuthUser(bob.userId);
      await waitForCurrentInstanceBoundTo(bob.userId);

      const bobInstanceId = requireDatabaseContext().currentInstanceId;
      if (!bobInstanceId) {
        throw new Error('Expected Bob instance id to be available');
      }

      let aliceInstanceId = '';
      await act(async () => {
        aliceInstanceId = await requireDatabaseContext().createInstance();
      });
      await waitForCurrentInstance(aliceInstanceId);
      await waitFor(() => {
        expect(requireAuthContext().isAuthenticated).toBe(false);
      });

      await act(async () => {
        storeAuth(alice.accessToken, alice.refreshToken, aliceAuth, {
          persistToken: false
        });
      });
      await waitForAuthUser(alice.userId);
      await waitForCurrentInstanceBoundTo(alice.userId);

      const updatedContent = 'Alice edited this shared note';
      const updatedPayload = toBase64(updatedContent);
      const occurredAt = new Date().toISOString();

      await ctx.pool.query(
        `UPDATE vfs_item_state
         SET encrypted_payload = $2,
             key_epoch = 1,
             encryption_nonce = $3,
             encryption_aad = $4,
             encryption_signature = $5,
             updated_at = $6::timestamptz,
             deleted_at = NULL
         WHERE item_id = $1`,
        [
          seededShare.noteId,
          updatedPayload,
          toBase64(`nonce-${randomUUID()}`),
          toBase64(`aad-${randomUUID()}`),
          toBase64(`sig-${randomUUID()}`),
          occurredAt
        ]
      );
      const expectedOpId = randomUUID();

      await ctx.pool.query(
        `INSERT INTO vfs_crdt_ops (
           id,
           item_id,
           op_type,
           actor_id,
           source_table,
           source_id,
           occurred_at,
           encrypted_payload,
           key_epoch,
           encryption_nonce,
           encryption_aad,
           encryption_signature,
           encrypted_payload_bytes,
           encryption_nonce_bytes,
           encryption_aad_bytes,
           encryption_signature_bytes
         ) VALUES (
           $1,
           $2,
           'item_upsert',
           $3,
           'vfs_item_state',
           $4,
           $5::timestamptz,
           NULL,
           1,
           NULL,
           NULL,
           NULL,
           decode($6::text, 'base64'),
           decode($7::text, 'base64'),
           decode($8::text, 'base64'),
           decode($9::text, 'base64')
         )`,
        [
          expectedOpId,
          seededShare.noteId,
          alice.userId,
          seededShare.noteId,
          occurredAt,
          updatedPayload,
          toBase64(`nonce-${randomUUID()}`),
          toBase64(`aad-${randomUUID()}`),
          toBase64(`sig-${randomUUID()}`)
        ]
      );

      await act(async () => {
        await requireDatabaseContext().switchInstance(bobInstanceId);
      });
      await waitForCurrentInstance(bobInstanceId);
      await waitForCurrentInstanceBoundTo(bob.userId);

      await waitFor(() => {
        const auth = requireAuthContext();
        expect(auth.isAuthenticated).toBe(true);
        expect(auth.user?.id).toBe(bob.userId);
      });

      const storedAuthActor = createTokenActor({
        baseUrl: apiBaseUrl,
        resolveToken: () => bob.accessToken
      });
      const bobCrdtFeed = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
        actor: storedAuthActor,
        methodName: 'GetCrdtSync',
        requestBody: { limit: 500 }
      });

      expect(
        bobCrdtFeed.items.some(
          (item) =>
            item.opId === expectedOpId &&
            item.itemId === seededShare.noteId &&
            item.opType === 'item_upsert' &&
            item.sourceTable === 'vfs_item_state'
        )
      ).toBe(true);
    },
    TEST_TIMEOUT_MS
  );
});
