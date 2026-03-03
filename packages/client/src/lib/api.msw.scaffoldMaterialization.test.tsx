import '../test/setupIntegration';

import { seedTestUser } from '@tearleads/api-test-utils';
import { emails, vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import type { VfsCrdtSyncResponse, VfsSyncResponse } from '@tearleads/shared';
import { screen, waitFor } from '@testing-library/react';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@/db';
import { clearStoredAuth, storeAuth } from '@/lib/authStorage';
import { renderWithDatabase } from '@/test/renderWithDatabase';
import { getSharedTestContext } from '@/test/testContext';
import { setupBobNotesShareForAliceDb } from '../../../shared/src/scaffolding/setupBobNotesShareForAliceDb.js';
import { setupWelcomeEmailsDb } from '../../../shared/src/scaffolding/setupWelcomeEmailsDb.js';

afterEach(() => {
  clearStoredAuth();
  vi.unstubAllEnvs();
});

function expectCiphertext(value: string | null | undefined): void {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^[A-Za-z0-9+/=]+$/);
}

describe('DB scaffolding plaintext render integration', () => {
  it('keeps ciphertext in Postgres and renders plaintext in VFS + Email UIs after sync', async () => {
    const ctx = getSharedTestContext();
    const bob = await seedTestUser(ctx, { email: 'bob@test.local' });
    const alice = await seedTestUser(ctx, { email: 'alice@test.local' });

    const client = await ctx.pool.connect();

    let seededShare: Awaited<ReturnType<typeof setupBobNotesShareForAliceDb>>;
    let seededEmails: Awaited<ReturnType<typeof setupWelcomeEmailsDb>>;
    try {
      seededShare = await setupBobNotesShareForAliceDb({
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

    const postgresFolder = await ctx.pool.query<{ encrypted_name: string | null }>(
      `SELECT encrypted_name FROM vfs_registry WHERE id = $1`,
      [seededShare.folderId]
    );
    const postgresInboxFolder = await ctx.pool.query<{ encrypted_name: string | null }>(
      `SELECT encrypted_name FROM vfs_registry WHERE id = $1`,
      [seededEmails.bob.inboxFolderId]
    );
    const postgresEmail = await ctx.pool.query<{
      encrypted_subject: string | null;
      encrypted_from: string | null;
    }>(
      `SELECT encrypted_subject, encrypted_from FROM emails WHERE id = $1`,
      [seededEmails.bob.emailItemId]
    );

    const folderCiphertext = postgresFolder.rows[0]?.encrypted_name;
    const inboxCiphertext = postgresInboxFolder.rows[0]?.encrypted_name;
    const subjectCiphertext = postgresEmail.rows[0]?.encrypted_subject;
    const fromCiphertext = postgresEmail.rows[0]?.encrypted_from;

    expect(folderCiphertext).not.toBe('Notes shared with Alice');
    expectCiphertext(folderCiphertext);
    expect(inboxCiphertext).not.toBe('Inbox');
    expectCiphertext(inboxCiphertext);
    expect(subjectCiphertext).not.toBe('Welcome to Tearleads');
    expectCiphertext(subjectCiphertext);
    expect(fromCiphertext).not.toBe('system@tearleads.com');
    expectCiphertext(fromCiphertext);

    const bobAuthUser = {
      id: bob.userId,
      email: bob.email
    };
    storeAuth(bob.accessToken, bob.refreshToken, bobAuthUser);
    vi.stubEnv('VITE_API_URL', `${ctx.baseUrl}/v1`);

    const fetchConnectVfsJson = async <TResponse,>(
      methodName: 'GetSync' | 'GetCrdtSync',
      body: { limit: number; cursor?: string }
    ): Promise<TResponse> => {
      const response = await fetch(
        `${ctx.baseUrl}/v1/connect/tearleads.v1.VfsService/${methodName}`,
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
      const connectEnvelope = (await response.json()) as { json: string };
      return JSON.parse(connectEnvelope.json) as TResponse;
    };

    vi.doMock('@/lib/api', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/api')>();
      return {
        ...actual,
        api: {
          ...actual.api,
          vfs: {
            ...actual.api.vfs,
            getSync: async (cursor?: string, limit = 500) =>
              fetchConnectVfsJson<VfsSyncResponse>('GetSync', {
                limit,
                ...(cursor ? { cursor } : {})
              }),
            getCrdtSync: async (cursor?: string, limit = 500) =>
              fetchConnectVfsJson<VfsCrdtSyncResponse>('GetCrdtSync', {
                limit,
                ...(cursor ? { cursor } : {})
              })
          }
        }
      };
    });

    const { Vfs: VfsPage } = await import('@/pages/Vfs');
    const { Email: EmailPage } = await import('@/pages/Email');
    const { rematerializeRemoteVfsStateIfNeeded } = await import(
      '@/lib/vfsRematerialization'
    );

    const vfsRender = await renderWithDatabase(<VfsPage />, {
      beforeRender: async () => {
        const localDb = getDatabase();
        await localDb.delete(vfsLinks);
        await localDb.delete(vfsRegistry);
        const rematerialized = await rematerializeRemoteVfsStateIfNeeded();
        expect(rematerialized).toBe(true);
      }
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'VFS Explorer' })).toBeInTheDocument();
      expect(screen.getByText('Notes shared with Alice')).toBeInTheDocument();
      expect(screen.queryByText(folderCiphertext ?? '')).not.toBeInTheDocument();
    });

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

    vfsRender.unmount();

    const emailRender = await renderWithDatabase(<EmailPage />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Email' })).toBeInTheDocument();
      expect(screen.getByText('Inbox')).toBeInTheDocument();
      expect(screen.getByText('Welcome to Tearleads')).toBeInTheDocument();
      expect(screen.getByText('From: system@tearleads.com')).toBeInTheDocument();
      expect(screen.queryByText(inboxCiphertext ?? '')).not.toBeInTheDocument();
      expect(screen.queryByText(subjectCiphertext ?? '')).not.toBeInTheDocument();
    });

    const localEmailSubject = await db
      .select({
        subject: emails.encryptedSubject
      })
      .from(emails)
      .where(eq(emails.id, seededEmails.bob.emailItemId));
    expect(localEmailSubject).toHaveLength(0);

    emailRender.unmount();
  });
});
