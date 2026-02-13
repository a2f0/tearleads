import type { Database } from '@tearleads/db/sqlite';
import { contactEmails, contacts, vfsLinks } from '@tearleads/db/sqlite';
import { and, asc, eq } from 'drizzle-orm';

export async function getPrimaryEmailsForGroup(
  db: Database,
  groupId: string
): Promise<string[]> {
  const rows = await db
    .select({ email: contactEmails.email })
    .from(vfsLinks)
    .innerJoin(
      contacts,
      and(eq(contacts.id, vfsLinks.childId), eq(contacts.deleted, false))
    )
    .innerJoin(
      contactEmails,
      and(eq(contactEmails.contactId, contacts.id), eq(contactEmails.isPrimary, true))
    )
    .where(eq(vfsLinks.parentId, groupId))
    .orderBy(asc(contactEmails.email));

  return rows.map((row) => row.email);
}
