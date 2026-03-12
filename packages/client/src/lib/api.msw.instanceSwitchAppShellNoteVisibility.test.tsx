import '../test/setupIntegration';

import { randomUUID } from 'node:crypto';
import { seedTestUser } from '@tearleads/api-test-utils';
import { notes, vfsRegistry } from '@tearleads/db/sqlite';
import { setupBobNotesShareForAliceDb } from '@tearleads/shared/scaffolding';
import { screen, waitFor } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import { act, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '@/AppRoutes';
import { AuthInstanceBinding } from '@/components/AuthInstanceBinding';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { api } from '@/lib/api';
import { clearStoredAuth, storeAuth } from '@/lib/authStorage';
import {
  buildPublicEncryptionKey,
  installConnectSyncMocks,
  seedUserKeys,
  toBase64
} from '@/lib/instanceSwitchTestUtils';
import { rematerializeRemoteVfsStateIfNeeded } from '@/lib/vfsRematerialization';
import { renderWithDatabase } from '@/test/renderWithDatabase';
import { getSharedTestContext } from '@/test/testContext';
import {
  installVfsConsoleGuard,
  type VfsConsoleGuard
} from '@/test/vfsConsoleGuard';

const TEST_TIMEOUT_MS = 60000;

interface AuthSnapshot {
  id: string;
  email: string;
}

let latestAuthContext: ReturnType<typeof useAuth> | null = null;
let latestDatabaseContext: ReturnType<typeof useDatabaseContext> | null = null;
let latestNavigate: ReturnType<typeof useNavigate> | null = null;
let vfsConsoleGuard: VfsConsoleGuard | null = null;
const { mockApiLogout } = vi.hoisted(() => ({
  mockApiLogout: vi.fn(async () => undefined)
}));

vi.mock('@/lib/api', () => ({
  api: {
    auth: {
      login: vi.fn(),
      register: vi.fn(),
      logout: () => mockApiLogout()
    },
    vfs: {
      getMyKeys: vi.fn(),
      setupKeys: vi.fn(async () => ({ created: true })),
      register: vi.fn(async () => ({})),
      getSync: vi.fn(),
      getCrdtSync: vi.fn()
    }
  },
  tryRefreshToken: vi.fn(async () => false)
}));

vi.mock('@/components/markdown-editor', () => ({
  LazyMarkdownEditor: ({
    value
  }: {
    value?: string;
    onChange: (nextValue: string | undefined) => void;
    colorMode: 'light' | 'dark';
    hideToolbar?: boolean;
  }) => <textarea data-testid="mock-md-editor" value={value ?? ''} readOnly />
}));

vi.mock('@/lib/vfsItemSyncWriter', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/vfsItemSyncWriter')>('@/lib/vfsItemSyncWriter');
  return {
    ...actual,
    queueItemUpsertAndFlush: vi.fn(async () => undefined),
    queueItemDeleteAndFlush: vi.fn(async () => undefined)
  };
});

function AuthContextProbe() {
  latestAuthContext = useAuth();
  return null;
}

function DatabaseContextProbe() {
  latestDatabaseContext = useDatabaseContext();
  return null;
}

function NavigationProbe() {
  latestNavigate = useNavigate();
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

function requireNavigate(): ReturnType<typeof useNavigate> {
  if (!latestNavigate) {
    throw new Error('Expected router navigate function to be available');
  }
  return latestNavigate;
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

async function waitForNoteBody(content: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByDisplayValue(content)).toBeInTheDocument();
  });
}

async function navigateToRoute(path: string): Promise<void> {
  await waitFor(() => {
    expect(latestNavigate).not.toBeNull();
  });
  await act(async () => {
    requireNavigate()(path);
  });
}

async function reloadSharedNoteRoute(noteId: string): Promise<void> {
  const nonExistentNoteId = `missing-note-${randomUUID()}`;
  await act(async () => {
    await navigateToRoute(`/notes/${nonExistentNoteId}`);
  });
  await waitFor(() => {
    expect(screen.getByText('Note not found')).toBeInTheDocument();
  });
  await act(async () => {
    await navigateToRoute(`/notes/${noteId}`);
  });
  await waitFor(() => {
    expect(screen.getByTestId('note-title')).toBeInTheDocument();
  });
}

describe('app shell instance-switch note visibility regression', () => {
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    vfsConsoleGuard = installVfsConsoleGuard();
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      if (msg.includes('not configured to support act')) {
        return;
      }
      originalConsoleError.call(console, ...args);
    };
    latestAuthContext = null;
    latestDatabaseContext = null;
    latestNavigate = null;
    clearStoredAuth();
    mockApiLogout.mockClear();
    api.vfs.getMyKeys.mockReset();
    api.vfs.setupKeys.mockReset();
    api.vfs.getSync.mockReset();
    api.vfs.getCrdtSync.mockReset();
    api.vfs.getMyKeys.mockResolvedValue({
      publicEncryptionKey: buildPublicEncryptionKey(),
      publicSigningKey: 'seeded-signing-key'
    });
    api.vfs.setupKeys.mockResolvedValue({ created: true });
  });

  afterEach(async () => {
    console.error = originalConsoleError;
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
    'keeps shared note body visible across Bob -> Alice -> Bob app-shell transitions',
    async () => {
      const ctx = getSharedTestContext();
      const apiBaseUrl = `${ctx.baseUrl}/v1`;

      const bob = await seedTestUser(ctx, {
        email: 'bob-app-shell-switch@test.local'
      });
      const alice = await seedTestUser(ctx, {
        email: 'alice-app-shell-switch@test.local'
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

      const noteKeyRows = await ctx.pool.query(
        `SELECT encrypted_session_key
         FROM vfs_registry
         WHERE id = $1
         LIMIT 1`,
        [seededShare.noteId]
      );
      const encryptedSessionKey =
        noteKeyRows.rows[0]?.['encrypted_session_key'];
      if (
        typeof encryptedSessionKey !== 'string' ||
        encryptedSessionKey.length === 0
      ) {
        throw new Error('Expected encrypted session key for scaffolded note');
      }

      const upsertLocalSharedNote = async (content: string): Promise<void> => {
        const db = getDatabase();
        const now = new Date();

        await db
          .delete(vfsRegistry)
          .where(eq(vfsRegistry.id, seededShare.noteId));
        await db.delete(notes).where(eq(notes.id, seededShare.noteId));

        await db.insert(notes).values({
          id: seededShare.noteId,
          title: 'Shared note',
          content,
          createdAt: now,
          updatedAt: now,
          deleted: false
        });

        await db.insert(vfsRegistry).values({
          id: seededShare.noteId,
          objectType: 'note',
          ownerId: bob.userId,
          encryptedSessionKey,
          createdAt: now
        });
      };

      await renderWithDatabase(
        <AuthProvider>
          <AuthInstanceBinding />
          <AuthContextProbe />
          <DatabaseContextProbe />
          <NavigationProbe />
          <Suspense fallback={<div>Loading...</div>}>
            <AppRoutes />
          </Suspense>
        </AuthProvider>,
        { initialRoute: `/notes/${seededShare.noteId}` }
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

      await upsertLocalSharedNote('Hello, Alice');
      await reloadSharedNoteRoute(seededShare.noteId);
      await waitForNoteBody('Hello, Alice');

      let aliceInstanceId = '';
      await act(async () => {
        aliceInstanceId = await requireDatabaseContext().createInstance();
      });
      await waitForCurrentInstance(aliceInstanceId);

      await act(async () => {
        storeAuth(alice.accessToken, alice.refreshToken, aliceAuth, {
          persistToken: false
        });
      });
      await waitForAuthUser(alice.userId);
      await waitForCurrentInstanceBoundTo(alice.userId);

      await upsertLocalSharedNote('Hello, Alice');
      await reloadSharedNoteRoute(seededShare.noteId);
      await waitForNoteBody('Hello, Alice');

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
          `crdt:item_upsert:${randomUUID()}`,
          seededShare.noteId,
          alice.userId,
          `vfs_item_state:${seededShare.noteId}`,
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

      installConnectSyncMocks({ baseUrl: apiBaseUrl });
      const db = getDatabase();
      await db
        .delete(vfsRegistry)
        .where(eq(vfsRegistry.id, seededShare.noteId));
      await db.delete(notes).where(eq(notes.id, seededShare.noteId));

      await expect(rematerializeRemoteVfsStateIfNeeded()).resolves.toBe(true);

      await waitFor(async () => {
        const rows = await db
          .select({
            content: notes.content
          })
          .from(notes)
          .where(eq(notes.id, seededShare.noteId))
          .limit(1);
        expect(rows[0]?.content).toBe(updatedContent);
      });

      await reloadSharedNoteRoute(seededShare.noteId);
      await waitForNoteBody('Alice edited this shared note');
    },
    TEST_TIMEOUT_MS
  );
});
