import { composedEmails, vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import {
  type Migration,
  mockConsoleWarn,
  withRealDatabase
} from '@tearleads/db-test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, type vi } from 'vitest';
import {
  deleteEmailDraftFromDb,
  getEmailDraftFromDb,
  listEmailDraftsFromDb,
  saveEmailDraftToDb
} from './sqliteDraftOperations';

/**
 * Minimal migrations for email draft integration tests.
 * Creates only the tables needed by the email draft operations.
 */
const emailTestMigrations: Migration[] = [
  {
    version: 1,
    up: async (adapter) => {
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_registry (
          id TEXT PRIMARY KEY,
          object_type TEXT NOT NULL,
          owner_id TEXT,
          organization_id TEXT,
          encrypted_session_key TEXT,
          public_hierarchical_key TEXT,
          encrypted_private_hierarchical_key TEXT,
          encrypted_name TEXT,
          icon TEXT,
          view_mode TEXT,
          default_sort TEXT,
          sort_direction TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS vfs_links (
          id TEXT PRIMARY KEY,
          parent_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
          child_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
          wrapped_session_key TEXT NOT NULL,
          wrapped_hierarchical_key TEXT,
          visible_children TEXT,
          position INTEGER,
          created_at INTEGER NOT NULL
        )
      `);
      await adapter.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS "vfs_links_parent_child_idx"
        ON "vfs_links" ("parent_id", "child_id")
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS "composed_emails" (
          "id" TEXT PRIMARY KEY NOT NULL REFERENCES "vfs_registry"("id") ON DELETE CASCADE,
          "encrypted_to" TEXT,
          "encrypted_cc" TEXT,
          "encrypted_bcc" TEXT,
          "encrypted_subject" TEXT,
          "encrypted_body" TEXT,
          "status" TEXT NOT NULL DEFAULT 'draft' CHECK("status" IN ('draft', 'sending', 'sent', 'failed')),
          "sent_at" INTEGER,
          "created_at" INTEGER NOT NULL,
          "updated_at" INTEGER NOT NULL
        )
      `);
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS "email_attachments" (
          "id" TEXT PRIMARY KEY NOT NULL,
          "composed_email_id" TEXT NOT NULL REFERENCES "composed_emails"("id") ON DELETE CASCADE,
          "encrypted_file_name" TEXT NOT NULL,
          "mime_type" TEXT NOT NULL,
          "size" INTEGER NOT NULL,
          "encrypted_storage_path" TEXT NOT NULL,
          "created_at" INTEGER NOT NULL
        )
      `);
      await adapter.execute('PRAGMA foreign_keys = ON');
    }
  }
];

describe('email drafts integration', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = mockConsoleWarn();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('saves a new compose draft, updates it, and deletes it in real db', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const saveResult = await saveEmailDraftToDb(db, {
          id: null,
          to: ['alice@example.com'],
          cc: [],
          bcc: [],
          subject: 'Initial subject',
          body: 'Draft body',
          attachments: [
            {
              id: 'att-1',
              fileName: 'hello.txt',
              mimeType: 'text/plain',
              size: 11,
              content: Buffer.from('hello world').toString('base64')
            }
          ]
        });

        const created = await getEmailDraftFromDb(db, saveResult.id);
        expect(created).not.toBeNull();
        expect(created?.subject).toBe('Initial subject');
        expect(created?.body).toBe('Draft body');
        expect(created?.to).toEqual(['alice@example.com']);
        expect(created?.attachments).toHaveLength(1);
        expect(created?.attachments[0]?.fileName).toBe('hello.txt');

        const listed = await listEmailDraftsFromDb(db);
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({
          id: saveResult.id,
          subject: 'Initial subject',
          to: ['alice@example.com']
        });

        const updateResult = await saveEmailDraftToDb(db, {
          id: saveResult.id,
          to: ['bob@example.com'],
          cc: ['charlie@example.com'],
          bcc: [],
          subject: 'Updated subject',
          body: 'Updated body',
          attachments: []
        });

        expect(updateResult.id).toBe(saveResult.id);

        const updated = await getEmailDraftFromDb(db, saveResult.id);
        expect(updated).not.toBeNull();
        expect(updated?.subject).toBe('Updated subject');
        expect(updated?.to).toEqual(['bob@example.com']);
        expect(updated?.cc).toEqual(['charlie@example.com']);
        expect(updated?.attachments).toHaveLength(0);

        const dbRows = await db
          .select({ id: composedEmails.id, status: composedEmails.status })
          .from(composedEmails)
          .where(eq(composedEmails.id, saveResult.id));

        expect(dbRows).toHaveLength(1);
        expect(dbRows[0]?.status).toBe('draft');

        const deleted = await deleteEmailDraftFromDb(db, saveResult.id);
        expect(deleted).toBe(true);

        const afterDelete = await getEmailDraftFromDb(db, saveResult.id);
        expect(afterDelete).toBeNull();
      },
      { migrations: emailTestMigrations }
    );
  });

  it('normalizes missing subject and body when saving drafts', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const draftInput = {
          id: null,
          to: ['alex@bitwisewebservices.com'],
          cc: [],
          bcc: [],
          subject: '',
          body: '',
          attachments: []
        };

        // Simulate runtime payload drift where subject/body are undefined.
        Object.defineProperty(draftInput, 'subject', { value: undefined });
        Object.defineProperty(draftInput, 'body', { value: undefined });

        const result = await saveEmailDraftToDb(db, draftInput);
        const saved = await getEmailDraftFromDb(db, result.id);

        expect(saved).not.toBeNull();
        expect(saved?.subject).toBe('');
        expect(saved?.body).toBe('');
        expect(saved?.to).toEqual(['alex@bitwisewebservices.com']);
      },
      { migrations: emailTestMigrations }
    );
  });

  it('links draft to Drafts folder when draftsFolderId is provided', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Create a Drafts folder first
        const draftsFolderId = crypto.randomUUID();
        const now = new Date();

        await db.insert(vfsRegistry).values({
          id: draftsFolderId,
          objectType: 'emailFolder',
          ownerId: null,
          encryptedName: 'Drafts',
          createdAt: now
        });

        // Save a draft with the draftsFolderId
        const saveResult = await saveEmailDraftToDb(
          db,
          {
            id: null,
            to: ['alice@example.com'],
            cc: [],
            bcc: [],
            subject: 'Test subject',
            body: 'Test body',
            attachments: []
          },
          draftsFolderId
        );

        // Verify the vfs_links entry was created
        const links = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, saveResult.id));

        expect(links).toHaveLength(1);
        expect(links[0]?.parentId).toBe(draftsFolderId);
        expect(links[0]?.childId).toBe(saveResult.id);

        // Update the draft and verify no duplicate links are created
        await saveEmailDraftToDb(
          db,
          {
            id: saveResult.id,
            to: ['bob@example.com'],
            cc: [],
            bcc: [],
            subject: 'Updated subject',
            body: 'Updated body',
            attachments: []
          },
          draftsFolderId
        );

        const linksAfterUpdate = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, saveResult.id));

        expect(linksAfterUpdate).toHaveLength(1);

        // Delete the draft and verify the link is cascade deleted
        await deleteEmailDraftFromDb(db, saveResult.id);

        const linksAfterDelete = await db
          .select()
          .from(vfsLinks)
          .where(eq(vfsLinks.childId, saveResult.id));

        expect(linksAfterDelete).toHaveLength(0);
      },
      { migrations: emailTestMigrations }
    );
  });
});
