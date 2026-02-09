import {
  type Migration,
  vfsTestMigrations,
  withRealDatabase
} from '@rapid/db-test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, type vi } from 'vitest';
import { mockConsoleWarn } from '../test/console-mocks';
import {
  deleteEmailDraftFromDb,
  getEmailDraftFromDb,
  listEmailDraftsFromDb,
  saveEmailDraftToDb
} from './email-drafts';
import { composedEmails } from './schema';

const draftTestMigrations: Migration[] = [
  ...vfsTestMigrations,
  {
    version: 2,
    up: async (adapter) => {
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS composed_emails (
          id TEXT PRIMARY KEY REFERENCES vfs_registry(id) ON DELETE CASCADE,
          encrypted_to TEXT,
          encrypted_cc TEXT,
          encrypted_bcc TEXT,
          encrypted_subject TEXT,
          encrypted_body TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          sent_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS email_attachments (
          id TEXT PRIMARY KEY,
          composed_email_id TEXT NOT NULL REFERENCES composed_emails(id) ON DELETE CASCADE,
          encrypted_file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          encrypted_storage_path TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
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
      { migrations: draftTestMigrations }
    );
  });
});
