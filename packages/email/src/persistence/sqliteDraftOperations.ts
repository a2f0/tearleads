import type { Database } from '@rapid/db/sqlite';
import { composedEmails, emailAttachments, vfsRegistry } from '@rapid/db/sqlite';
import { desc, eq } from 'drizzle-orm';
import type {
  Attachment,
  DraftEmail,
  DraftListItem
} from '../types';
import type { SaveDraftInput } from '../context';

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (entry): entry is string => typeof entry === 'string'
        );
      }
    } catch {
      return [];
    }
  }

  return [];
}

function toIsoString(value: Date | number | null | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  throw new Error(
    `Invalid date value received by toIsoString: ${String(value)}`
  );
}

function stringifyEmails(emails: string[]): string {
  return JSON.stringify(emails);
}

function normalizeEmails(input: string[] | null | undefined): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

function normalizeText(input: string | null | undefined): string {
  return typeof input === 'string' ? input : '';
}

export async function saveEmailDraftToDb(
  db: Database,
  input: SaveDraftInput
): Promise<{ id: string; updatedAt: string }> {
  const now = new Date();
  const draftId = input.id ?? crypto.randomUUID();
  const to = normalizeEmails(input.to);
  const cc = normalizeEmails(input.cc);
  const bcc = normalizeEmails(input.bcc);
  const subject = normalizeText(input.subject);
  const body = normalizeText(input.body);
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];

  await db.transaction(async (tx) => {
    await tx
      .insert(vfsRegistry)
      .values({
        id: draftId,
        objectType: 'email',
        ownerId: null,
        createdAt: now
      })
      .onConflictDoNothing({ target: vfsRegistry.id });

    await tx
      .insert(composedEmails)
      .values({
        id: draftId,
        encryptedTo: stringifyEmails(to),
        encryptedCc: stringifyEmails(cc),
        encryptedBcc: stringifyEmails(bcc),
        encryptedSubject: subject,
        encryptedBody: body,
        status: 'draft',
        sentAt: null,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: composedEmails.id,
        set: {
          encryptedTo: stringifyEmails(to),
          encryptedCc: stringifyEmails(cc),
          encryptedBcc: stringifyEmails(bcc),
          encryptedSubject: subject,
          encryptedBody: body,
          status: 'draft',
          updatedAt: now
        }
      });

    await tx
      .delete(emailAttachments)
      .where(eq(emailAttachments.composedEmailId, draftId));

    if (attachments.length > 0) {
      await tx.insert(emailAttachments).values(
        attachments.map((attachment) => ({
          id: attachment.id,
          composedEmailId: draftId,
          encryptedFileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
          encryptedStoragePath: attachment.content ?? '',
          createdAt: now
        }))
      );
    }
  });

  return {
    id: draftId,
    updatedAt: now.toISOString()
  };
}

export async function getEmailDraftFromDb(
  db: Database,
  id: string
): Promise<DraftEmail | null> {
  const [draftRow] = await db
    .select()
    .from(composedEmails)
    .where(eq(composedEmails.id, id));

  if (!draftRow) {
    return null;
  }

  const attachmentRows = await db
    .select()
    .from(emailAttachments)
    .where(eq(emailAttachments.composedEmailId, id));

  const attachments: Attachment[] = attachmentRows.map((row) => {
    const attachment: Attachment = {
      id: row.id,
      fileName: row.encryptedFileName,
      mimeType: row.mimeType,
      size: row.size
    };

    if (row.encryptedStoragePath.length > 0) {
      attachment.content = row.encryptedStoragePath;
    }

    return attachment;
  });

  return {
    id: draftRow.id,
    to: toStringArray(draftRow.encryptedTo),
    cc: toStringArray(draftRow.encryptedCc),
    bcc: toStringArray(draftRow.encryptedBcc),
    subject: draftRow.encryptedSubject ?? '',
    body: draftRow.encryptedBody ?? '',
    attachments,
    createdAt: toIsoString(draftRow.createdAt),
    updatedAt: toIsoString(draftRow.updatedAt)
  };
}

export async function listEmailDraftsFromDb(
  db: Database
): Promise<DraftListItem[]> {
  const rows = await db
    .select()
    .from(composedEmails)
    .where(eq(composedEmails.status, 'draft'))
    .orderBy(desc(composedEmails.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    to: toStringArray(row.encryptedTo),
    subject: row.encryptedSubject ?? '',
    updatedAt: toIsoString(row.updatedAt)
  }));
}

export async function deleteEmailDraftFromDb(
  db: Database,
  id: string
): Promise<boolean> {
  const [existing] = await db
    .select({ id: composedEmails.id })
    .from(composedEmails)
    .where(eq(composedEmails.id, id));

  if (!existing) {
    return false;
  }

  // vfs_registry -> composed_emails -> email_attachments use ON DELETE CASCADE.
  await db.delete(vfsRegistry).where(eq(vfsRegistry.id, id));

  return true;
}
