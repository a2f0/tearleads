import { withRealDatabase } from '@tearleads/db-test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, type vi } from 'vitest';
import { mockConsoleWarn } from '../test/consoleMocks';
import {
  deleteEmailDraftFromDb,
  getEmailDraftFromDb,
  listEmailDraftsFromDb,
  saveEmailDraftToDb
} from './emailDrafts';
import { migrations } from './migrations';
import { composedEmails, vfsLinks, vfsRegistry } from './schema';

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
      { migrations }
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
      { migrations }
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
      { migrations }
    );
  });
});
