import '../test/setupIntegration';

import { seedTestUser } from '@tearleads/api-test-utils';
import {
  albums,
  emails,
  files,
  vfsLinks,
  vfsRegistry
} from '@tearleads/db/sqlite';
import type { VfsCrdtSyncResponse, VfsSyncResponse } from '@tearleads/shared';
import {
  combinePublicKey,
  generateKeyPair,
  parseConnectJsonEnvelopeBody,
  parseConnectJsonString,
  serializePublicKey,
  VFS_V2_CONNECT_BASE_PATH
} from '@tearleads/shared';
import {
  SCAFFOLD_INLINE_EMAIL_BODY_PREFIX,
  SCAFFOLD_WELCOME_EMAIL_BODY_TEXT,
  setupBobNotesShareForAliceDb,
  setupBobPhotoAlbumShareForAliceDb,
  setupWelcomeEmailsDb
} from '@tearleads/shared/scaffolding';
import { screen, waitFor } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../test/env.js';

// Use real implementation instead of global mock (integration test with real DB)
vi.mock('@/db/hooks/useHostRuntimeDatabaseState', async (importOriginal) => {
  return await importOriginal<
    typeof import('@/db/hooks/useHostRuntimeDatabaseState')
  >();
});

import { getDatabase } from '@/db';
import { clearStoredAuth, storeAuth } from '@/lib/authStorage';
import { renderWithDatabase } from '@/test/renderWithDatabase';
import { getSharedTestContext } from '@/test/testContext';
import {
  installVfsConsoleGuard,
  type VfsConsoleGuard
} from '@/test/vfsConsoleGuard';

let vfsConsoleGuard: VfsConsoleGuard | null = null;

beforeEach(() => {
  vfsConsoleGuard = installVfsConsoleGuard();
});

afterEach(async () => {
  try {
    await vfsConsoleGuard?.assertNoRegressions({ gracePeriodMs: 25 });
  } finally {
    vfsConsoleGuard?.restore();
    vfsConsoleGuard = null;
    clearStoredAuth();
  }
});

function expectCiphertext(value: string | null | undefined): void {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^[A-Za-z0-9+/=]+$/);
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

describe('DB scaffolding plaintext render integration', () => {
  it('keeps ciphertext in Postgres and renders plaintext in VFS + Email UIs after sync', async () => {
    const ctx = getSharedTestContext();
    const bob = await seedTestUser(ctx, { email: 'bob@test.local' });
    const alice = await seedTestUser(ctx, { email: 'alice@test.local' });
    const bobPublicKey = buildPublicEncryptionKey();
    const alicePublicKey = buildPublicEncryptionKey();

    await ctx.pool.query(
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
        bob.userId,
        bobPublicKey,
        'seeded-signing-key-bob',
        'seeded-private-keys-bob',
        'seeded-argon2-salt-bob'
      ]
    );
    await ctx.pool.query(
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
        alice.userId,
        alicePublicKey,
        'seeded-signing-key-alice',
        'seeded-private-keys-alice',
        'seeded-argon2-salt-alice'
      ]
    );

    const client = await ctx.pool.connect();

    let seededShare: Awaited<ReturnType<typeof setupBobNotesShareForAliceDb>>;
    let seededPhotos: Awaited<
      ReturnType<typeof setupBobPhotoAlbumShareForAliceDb>
    >;
    let seededEmails: Awaited<ReturnType<typeof setupWelcomeEmailsDb>>;
    try {
      seededShare = await setupBobNotesShareForAliceDb({
        client,
        bobEmail: bob.email,
        aliceEmail: alice.email,
        hasOrganizationIdColumn: true
      });
      seededPhotos = await setupBobPhotoAlbumShareForAliceDb({
        client,
        bobEmail: bob.email,
        aliceEmail: alice.email,
        hasOrganizationIdColumn: true
      });
      seededEmails = await setupWelcomeEmailsDb({
        client,
        bobEmail: bob.email,
        aliceEmail: alice.email,
        hasOrganizationIdColumn: true
      });
    } finally {
      client.release();
    }

    const postgresFolder = await ctx.pool.query<{
      encrypted_name: string | null;
      encrypted_session_key: string | null;
    }>(
      `SELECT encrypted_name, encrypted_session_key FROM vfs_registry WHERE id = $1`,
      [seededShare.folderId]
    );
    const postgresAlbum = await ctx.pool.query<{
      encrypted_name: string | null;
      encrypted_session_key: string | null;
    }>(
      `SELECT encrypted_name, encrypted_session_key FROM vfs_registry WHERE id = $1`,
      [seededPhotos.albumId]
    );
    const postgresPhoto = await ctx.pool.query<{
      encrypted_name: string | null;
      encrypted_session_key: string | null;
    }>(
      `SELECT encrypted_name, encrypted_session_key FROM vfs_registry WHERE id = $1`,
      [seededPhotos.photoId]
    );
    const postgresInboxFolder = await ctx.pool.query<{
      encrypted_name: string | null;
      encrypted_session_key: string | null;
    }>(
      `SELECT encrypted_name, encrypted_session_key FROM vfs_registry WHERE id = $1`,
      [seededEmails.bob.inboxFolderId]
    );
    const postgresEmail = await ctx.pool.query<{
      encrypted_subject: string | null;
      encrypted_from: string | null;
      encrypted_body_path: string | null;
      ciphertext_size: number | null;
    }>(
      `SELECT encrypted_subject, encrypted_from, encrypted_body_path, ciphertext_size
       FROM emails
       WHERE id = $1`,
      [seededEmails.bob.emailItemId]
    );

    const folderCiphertext = postgresFolder.rows[0]?.encrypted_name;
    const albumCiphertext = postgresAlbum.rows[0]?.encrypted_name;
    const photoCiphertext = postgresPhoto.rows[0]?.encrypted_name;
    const inboxCiphertext = postgresInboxFolder.rows[0]?.encrypted_name;
    const folderSessionKey = postgresFolder.rows[0]?.encrypted_session_key;
    const albumSessionKey = postgresAlbum.rows[0]?.encrypted_session_key;
    const photoSessionKey = postgresPhoto.rows[0]?.encrypted_session_key;
    const inboxSessionKey = postgresInboxFolder.rows[0]?.encrypted_session_key;
    const subjectCiphertext = postgresEmail.rows[0]?.encrypted_subject;
    const fromCiphertext = postgresEmail.rows[0]?.encrypted_from;
    const bodyPathCiphertext = postgresEmail.rows[0]?.encrypted_body_path;
    const bodyCiphertextSize = postgresEmail.rows[0]?.ciphertext_size;

    expect(folderCiphertext).not.toBe('Notes shared with Alice');
    expectCiphertext(folderCiphertext);
    expect(albumCiphertext).not.toBe('Photos shared with Alice');
    expectCiphertext(albumCiphertext);
    expect(photoCiphertext).not.toBe('Tearleads logo.svg');
    expectCiphertext(photoCiphertext);
    expect(inboxCiphertext).not.toBe('Inbox');
    expectCiphertext(inboxCiphertext);
    expect(subjectCiphertext).not.toBe('Welcome to Tearleads');
    expectCiphertext(subjectCiphertext);
    expect(fromCiphertext).not.toBe('system@tearleads.com');
    expectCiphertext(fromCiphertext);
    expect(typeof bodyPathCiphertext).toBe('string');
    if (typeof bodyPathCiphertext !== 'string') {
      throw new Error('Expected scaffolded encrypted email body payload');
    }
    expect(
      bodyPathCiphertext.startsWith(SCAFFOLD_INLINE_EMAIL_BODY_PREFIX)
    ).toBe(true);
    expect(bodyPathCiphertext.includes(SCAFFOLD_WELCOME_EMAIL_BODY_TEXT)).toBe(
      false
    );
    const inlineBodyCiphertext = bodyPathCiphertext.slice(
      SCAFFOLD_INLINE_EMAIL_BODY_PREFIX.length
    );
    expectCiphertext(inlineBodyCiphertext);
    expect((bodyCiphertextSize ?? 0) > 0).toBe(true);
    expect(folderSessionKey?.startsWith('scaffold-unwrapped:')).toBe(true);
    expect(albumSessionKey?.startsWith('scaffold-unwrapped:')).toBe(true);
    expect(photoSessionKey?.startsWith('scaffold-unwrapped:')).toBe(true);
    expect(inboxSessionKey?.startsWith('scaffold-unwrapped:')).toBe(true);

    const bobAuthUser = {
      id: bob.userId,
      email: bob.email
    };
    storeAuth(bob.accessToken, bob.refreshToken, bobAuthUser, {
      persistToken: false
    });
    setTestEnv('VITE_API_URL', `${ctx.baseUrl}/v1`);

    const fetchConnectVfsJson = async <TResponse,>(
      methodName: 'GetSync' | 'GetCrdtSync',
      body: { limit: number; cursor?: string }
    ): Promise<TResponse> => {
      const response = await fetch(
        `${ctx.baseUrl}/v1${VFS_V2_CONNECT_BASE_PATH}/${methodName}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bob.accessToken}`
          },
          body: JSON.stringify(body)
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `${methodName} failed with ${String(response.status)}: ${errorBody}`
        );
      }
      const connectEnvelope = await response.json();
      const parsedBody = parseConnectJsonEnvelopeBody(connectEnvelope);
      if (typeof parsedBody === 'string') {
        return parseConnectJsonString<TResponse>(parsedBody);
      }
      return parseConnectJsonString<TResponse>(JSON.stringify(parsedBody));
    };

    const { api } = await import('@/lib/api');
    const getSyncSpy = vi
      .spyOn(api.vfs, 'getSync')
      .mockImplementation(async (cursor?: string, limit = 500) =>
        fetchConnectVfsJson<VfsSyncResponse>('GetSync', {
          limit,
          ...(cursor ? { cursor } : {})
        })
      );
    const getCrdtSyncSpy = vi
      .spyOn(api.vfs, 'getCrdtSync')
      .mockImplementation(async (cursor?: string, limit = 500) =>
        fetchConnectVfsJson<VfsCrdtSyncResponse>('GetCrdtSync', {
          limit,
          ...(cursor ? { cursor } : {})
        })
      );

    try {
      const { Vfs: VfsPage } = await import('@/pages/Vfs');
      const { Email: EmailPage } = await import('@/pages/Email');
      const { rematerializeRemoteVfsStateIfNeeded } = await import(
        '@/lib/vfsRematerialization'
      );

      const vfsRender = await renderWithDatabase(createElement(VfsPage), {
        beforeRender: async () => {
          const localDb = getDatabase();
          await localDb.delete(vfsLinks);
          await localDb.delete(vfsRegistry);
          const rematerialized = await rematerializeRemoteVfsStateIfNeeded();
          expect(rematerialized).toBe(true);
        }
      });

      await screen.findByRole(
        'heading',
        { name: 'VFS Explorer' },
        { timeout: 5_000 }
      );
      await screen.findByText('Notes shared with Alice', undefined, {
        timeout: 5_000
      });
      await waitFor(
        () => {
          expect(
            screen.queryByText(folderCiphertext ?? '')
          ).not.toBeInTheDocument();
        },
        { timeout: 5_000 }
      );

      const db = getDatabase();
      const localFolder = await db
        .select({
          encryptedName: vfsRegistry.encryptedName,
          objectType: vfsRegistry.objectType
        })
        .from(vfsRegistry)
        .where(eq(vfsRegistry.id, seededShare.folderId));

      expect(localFolder[0]).toEqual(
        expect.objectContaining({
          objectType: 'folder',
          encryptedName: 'Notes shared with Alice'
        })
      );
      const localAlbum = await db
        .select({
          encryptedName: vfsRegistry.encryptedName,
          objectType: vfsRegistry.objectType
        })
        .from(vfsRegistry)
        .where(eq(vfsRegistry.id, seededPhotos.albumId));
      expect(localAlbum[0]).toEqual(
        expect.objectContaining({
          objectType: 'album',
          encryptedName: 'Photos shared with Alice'
        })
      );
      const localPhoto = await db
        .select({
          encryptedName: vfsRegistry.encryptedName,
          objectType: vfsRegistry.objectType
        })
        .from(vfsRegistry)
        .where(eq(vfsRegistry.id, seededPhotos.photoId));
      expect(localPhoto[0]).toEqual(
        expect.objectContaining({
          objectType: 'photo',
          encryptedName: 'Tearleads logo.svg'
        })
      );
      const localAlbumEntity = await db
        .select({
          id: albums.id,
          encryptedName: albums.encryptedName,
          albumType: albums.albumType
        })
        .from(albums)
        .where(eq(albums.id, seededPhotos.albumId));
      expect(localAlbumEntity[0]).toEqual(
        expect.objectContaining({
          id: seededPhotos.albumId,
          encryptedName: 'Photos shared with Alice',
          albumType: 'custom'
        })
      );
      const localPhotoEntity = await db
        .select({
          id: files.id,
          name: files.name,
          mimeType: files.mimeType,
          deleted: files.deleted
        })
        .from(files)
        .where(eq(files.id, seededPhotos.photoId));
      expect(localPhotoEntity[0]).toEqual(
        expect.objectContaining({
          id: seededPhotos.photoId,
          name: 'Tearleads logo.svg',
          mimeType: 'image/svg+xml',
          deleted: false
        })
      );

      vfsRender.unmount();

      const emailRender = await renderWithDatabase(createElement(EmailPage));

      await screen.findByRole('heading', { name: 'Email' }, { timeout: 5_000 });
      await screen.findByText('Inbox', undefined, { timeout: 5_000 });
      await screen.findByText('Welcome to Tearleads', undefined, {
        timeout: 5_000
      });
      await screen.findByText('From: system@tearleads.com', undefined, {
        timeout: 5_000
      });
      await waitFor(
        () => {
          expect(
            screen.queryByText(inboxCiphertext ?? '')
          ).not.toBeInTheDocument();
          expect(
            screen.queryByText(subjectCiphertext ?? '')
          ).not.toBeInTheDocument();
        },
        { timeout: 5_000 }
      );

      const localEmailSubject = await db
        .select({
          subject: emails.encryptedSubject
        })
        .from(emails)
        .where(eq(emails.id, seededEmails.bob.emailItemId));
      expect(localEmailSubject).toHaveLength(0);

      emailRender.unmount();
    } finally {
      getSyncSpy.mockRestore();
      getCrdtSyncSpy.mockRestore();
    }
  });
});
