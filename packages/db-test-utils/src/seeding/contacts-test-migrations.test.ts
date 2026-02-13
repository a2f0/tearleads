import type { Database } from '@tearleads/db/sqlite';
import {
  contactEmails,
  contactGroups,
  contacts,
  vfsLinks
} from '@tearleads/db/sqlite';
import { and, asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withRealDatabase } from '../with-real-database.js';
import { contactsTestMigrations } from './contacts-test-migrations.js';
import { ensureVfsRoot, seedVfsItem, seedVfsLink, VFS_ROOT_ID } from './vfs.js';

/**
 * Helper to seed a contact with optional primary email.
 */
async function seedContact(
  db: Database,
  options: {
    id?: string;
    firstName: string;
    lastName?: string;
    primaryEmail?: string;
    deleted?: boolean;
  }
): Promise<string> {
  const id = options.id ?? crypto.randomUUID();
  const now = new Date();

  await db.insert(contacts).values({
    id,
    firstName: options.firstName,
    lastName: options.lastName ?? null,
    createdAt: now,
    updatedAt: now,
    deleted: options.deleted ?? false
  });

  if (options.primaryEmail) {
    await db.insert(contactEmails).values({
      id: crypto.randomUUID(),
      contactId: id,
      email: options.primaryEmail,
      isPrimary: true
    });
  }

  return id;
}

/**
 * Helper to seed a contact group (uses VFS registry pattern).
 */
async function seedContactGroup(
  db: Database,
  options: { id?: string; name?: string }
): Promise<string> {
  await ensureVfsRoot(db);
  const groupId = await seedVfsItem(db, {
    ...(options.id !== undefined && { id: options.id }),
    objectType: 'contactGroup',
    parentId: VFS_ROOT_ID
  });

  // Insert into contact_groups extension table
  await db.insert(contactGroups).values({
    id: groupId,
    encryptedName: options.name ?? 'Test Group'
  });

  return groupId;
}

describe('contacts group email query', () => {
  it('returns primary emails for contacts in a group', async () => {
    await withRealDatabase(
      async ({ db }) => {
        // Seed a contact group
        const groupId = await seedContactGroup(db, { name: 'Family' });

        // Seed contacts with primary emails
        const aliceId = await seedContact(db, {
          firstName: 'Alice',
          primaryEmail: 'alice@example.com'
        });
        const bobId = await seedContact(db, {
          firstName: 'Bob',
          primaryEmail: 'bob@example.com'
        });

        // Link contacts to group
        await seedVfsItem(db, { id: aliceId, objectType: 'contact' });
        await seedVfsItem(db, { id: bobId, objectType: 'contact' });
        await seedVfsLink(db, { parentId: groupId, childId: aliceId });
        await seedVfsLink(db, { parentId: groupId, childId: bobId });

        // Run the exact query from handleSendEmailToGroup
        const groupEmails = await db
          .select({ email: contactEmails.email })
          .from(vfsLinks)
          .innerJoin(
            contacts,
            and(eq(contacts.id, vfsLinks.childId), eq(contacts.deleted, false))
          )
          .innerJoin(
            contactEmails,
            and(
              eq(contactEmails.contactId, contacts.id),
              eq(contactEmails.isPrimary, true)
            )
          )
          .where(eq(vfsLinks.parentId, groupId))
          .orderBy(asc(contactEmails.email));

        expect(groupEmails).toHaveLength(2);
        expect(groupEmails.map((r) => r.email)).toEqual([
          'alice@example.com',
          'bob@example.com'
        ]);
      },
      { migrations: contactsTestMigrations }
    );
  });

  it('excludes deleted contacts from results', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const groupId = await seedContactGroup(db, { name: 'Work' });

        // One active contact, one deleted
        const activeId = await seedContact(db, {
          firstName: 'Active',
          primaryEmail: 'active@example.com',
          deleted: false
        });
        const deletedId = await seedContact(db, {
          firstName: 'Deleted',
          primaryEmail: 'deleted@example.com',
          deleted: true
        });

        // Register both in VFS and link to group
        await seedVfsItem(db, { id: activeId, objectType: 'contact' });
        await seedVfsItem(db, { id: deletedId, objectType: 'contact' });
        await seedVfsLink(db, { parentId: groupId, childId: activeId });
        await seedVfsLink(db, { parentId: groupId, childId: deletedId });

        const groupEmails = await db
          .select({ email: contactEmails.email })
          .from(vfsLinks)
          .innerJoin(
            contacts,
            and(eq(contacts.id, vfsLinks.childId), eq(contacts.deleted, false))
          )
          .innerJoin(
            contactEmails,
            and(
              eq(contactEmails.contactId, contacts.id),
              eq(contactEmails.isPrimary, true)
            )
          )
          .where(eq(vfsLinks.parentId, groupId))
          .orderBy(asc(contactEmails.email));

        expect(groupEmails).toHaveLength(1);
        expect(groupEmails[0]?.email).toBe('active@example.com');
      },
      { migrations: contactsTestMigrations }
    );
  });

  it('excludes contacts without primary email', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const groupId = await seedContactGroup(db, { name: 'Friends' });

        // One with email, one without
        const withEmailId = await seedContact(db, {
          firstName: 'WithEmail',
          primaryEmail: 'has@example.com'
        });
        const withoutEmailId = await seedContact(db, {
          firstName: 'WithoutEmail'
          // No primary email
        });

        await seedVfsItem(db, { id: withEmailId, objectType: 'contact' });
        await seedVfsItem(db, { id: withoutEmailId, objectType: 'contact' });
        await seedVfsLink(db, { parentId: groupId, childId: withEmailId });
        await seedVfsLink(db, { parentId: groupId, childId: withoutEmailId });

        const groupEmails = await db
          .select({ email: contactEmails.email })
          .from(vfsLinks)
          .innerJoin(
            contacts,
            and(eq(contacts.id, vfsLinks.childId), eq(contacts.deleted, false))
          )
          .innerJoin(
            contactEmails,
            and(
              eq(contactEmails.contactId, contacts.id),
              eq(contactEmails.isPrimary, true)
            )
          )
          .where(eq(vfsLinks.parentId, groupId))
          .orderBy(asc(contactEmails.email));

        expect(groupEmails).toHaveLength(1);
        expect(groupEmails[0]?.email).toBe('has@example.com');
      },
      { migrations: contactsTestMigrations }
    );
  });

  it('returns empty array for empty group', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const groupId = await seedContactGroup(db, { name: 'Empty' });

        const groupEmails = await db
          .select({ email: contactEmails.email })
          .from(vfsLinks)
          .innerJoin(
            contacts,
            and(eq(contacts.id, vfsLinks.childId), eq(contacts.deleted, false))
          )
          .innerJoin(
            contactEmails,
            and(
              eq(contactEmails.contactId, contacts.id),
              eq(contactEmails.isPrimary, true)
            )
          )
          .where(eq(vfsLinks.parentId, groupId))
          .orderBy(asc(contactEmails.email));

        expect(groupEmails).toHaveLength(0);
      },
      { migrations: contactsTestMigrations }
    );
  });

  it('only returns isPrimary=true emails', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const groupId = await seedContactGroup(db, { name: 'TestPrimary' });

        // Create contact with multiple emails (only one primary)
        const contactId = await seedContact(db, {
          firstName: 'Multi',
          primaryEmail: 'primary@example.com'
        });

        // Add a secondary (non-primary) email
        await db.insert(contactEmails).values({
          id: crypto.randomUUID(),
          contactId,
          email: 'secondary@example.com',
          isPrimary: false
        });

        await seedVfsItem(db, { id: contactId, objectType: 'contact' });
        await seedVfsLink(db, { parentId: groupId, childId: contactId });

        const groupEmails = await db
          .select({ email: contactEmails.email })
          .from(vfsLinks)
          .innerJoin(
            contacts,
            and(eq(contacts.id, vfsLinks.childId), eq(contacts.deleted, false))
          )
          .innerJoin(
            contactEmails,
            and(
              eq(contactEmails.contactId, contacts.id),
              eq(contactEmails.isPrimary, true)
            )
          )
          .where(eq(vfsLinks.parentId, groupId))
          .orderBy(asc(contactEmails.email));

        expect(groupEmails).toHaveLength(1);
        expect(groupEmails[0]?.email).toBe('primary@example.com');
      },
      { migrations: contactsTestMigrations }
    );
  });

  it('handles duplicate emails from same contact in group correctly', async () => {
    await withRealDatabase(
      async ({ db }) => {
        const groupId = await seedContactGroup(db, { name: 'TestDuplicates' });

        const contactId = await seedContact(db, {
          firstName: 'Same',
          primaryEmail: 'same@example.com'
        });

        await seedVfsItem(db, { id: contactId, objectType: 'contact' });
        await seedVfsLink(db, { parentId: groupId, childId: contactId });

        const groupEmails = await db
          .select({ email: contactEmails.email })
          .from(vfsLinks)
          .innerJoin(
            contacts,
            and(eq(contacts.id, vfsLinks.childId), eq(contacts.deleted, false))
          )
          .innerJoin(
            contactEmails,
            and(
              eq(contactEmails.contactId, contacts.id),
              eq(contactEmails.isPrimary, true)
            )
          )
          .where(eq(vfsLinks.parentId, groupId))
          .orderBy(asc(contactEmails.email));

        // Each contact should only appear once
        expect(groupEmails).toHaveLength(1);
      },
      { migrations: contactsTestMigrations }
    );
  });
});
