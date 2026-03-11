import { Buffer } from 'node:buffer';
import { Code, ConnectError } from '@connectrpc/connect';
import {
  buildVfsV2ConnectMethodPath,
  VFS_V2_GET_EMAIL_CONNECT_PATH,
  VFS_V2_GET_EMAILS_CONNECT_PATH,
  VFS_V2_SEND_EMAIL_CONNECT_PATH
} from '@tearleads/shared';
import { type EmailAttachment, sendEmail } from '../../lib/emailSender.js';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import { deleteVfsBlobByStorageKey } from '../../lib/vfsBlobStore.js';
import { requireVfsClaims } from './vfsDirectAuth.js';
import { parseSendRequestPayload } from './vfsDirectEmailPayload.js';

type GetEmailsRequest = { offset: number; limit: number };
type EmailIdRequest = { id: string };
type SendEmailRequest = unknown;

export interface EmailListItem {
  id: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: string;
  size: number;
}

const SCAFFOLD_INLINE_EMAIL_BODY_PREFIX = 'scaffolding:inline-body:';

function decodeBase64Utf8(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return null;
  }

  const missingPadding = normalized.length % 4;
  const padded =
    missingPadding === 0
      ? normalized
      : `${normalized}${'='.repeat(4 - missingPadding)}`;

  let bytes: Uint8Array | null = null;
  try {
    bytes = Uint8Array.from(Buffer.from(padded, 'base64'));
    if (bytes.length === 0) {
      return null;
    }
    const roundTripBase64 = Buffer.from(bytes).toString('base64');
    const stripPadding = (input: string) => input.replace(/=+$/g, '');
    if (stripPadding(roundTripBase64) !== stripPadding(padded)) {
      return null;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  } finally {
    bytes?.fill(0);
  }
}

function decodeMaybeBase64Utf8(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  return decodeBase64Utf8(value) ?? value;
}

function parseScaffoldInlineBody(
  encryptedBodyPath: string | null | undefined
): string | null {
  if (
    typeof encryptedBodyPath !== 'string' ||
    !encryptedBodyPath.startsWith(SCAFFOLD_INLINE_EMAIL_BODY_PREFIX)
  ) {
    return null;
  }

  const encodedBody = encryptedBodyPath.slice(
    SCAFFOLD_INLINE_EMAIL_BODY_PREFIX.length
  );
  return decodeBase64Utf8(encodedBody);
}

function decodeRecipientList(value: unknown): string[] {
  return toStringArray(value).map((entry) => decodeMaybeBase64Utf8(entry));
}

function normalizeTimestamp(value: string | Date): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return '';
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      entries.push(entry);
    }
  }
  return entries;
}

export async function getEmailsDirect(
  request: GetEmailsRequest,
  context: { requestHeader: Headers }
): Promise<{
  emails: EmailListItem[];
  total: number;
  offset: number;
  limit: number;
}> {
  const claims = await requireVfsClaims(
    VFS_V2_GET_EMAILS_CONNECT_PATH,
    context.requestHeader
  );

  const offset = Math.max(
    0,
    Number.isFinite(request.offset) ? Math.floor(request.offset) : 0
  );
  const parsedLimit =
    Number.isFinite(request.limit) && request.limit > 0
      ? Math.floor(request.limit)
      : 50;
  const limit = Math.min(100, parsedLimit);

  try {
    const pool = await getPool('read');
    const totalResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM emails e
         INNER JOIN vfs_registry vr ON vr.id = e.id
         WHERE vr.owner_id = $1`,
      [claims.sub]
    );
    const total = parseInt(totalResult.rows[0]?.total ?? '0', 10) || 0;

    const rows = await pool.query<{
      id: string;
      encrypted_from: string | null;
      encrypted_to: unknown;
      encrypted_subject: string | null;
      received_at: string | Date;
      ciphertext_size: number | null;
    }>(
      `SELECT
           e.id,
           e.encrypted_from,
           e.encrypted_to,
           e.encrypted_subject,
           e.received_at,
           e.ciphertext_size
         FROM emails e
         INNER JOIN vfs_registry vr ON vr.id = e.id
         WHERE vr.owner_id = $1
         ORDER BY e.received_at DESC
         OFFSET $2
         LIMIT $3`,
      [claims.sub, offset, limit]
    );

    const emails: EmailListItem[] = rows.rows.map((row) => ({
      id: row.id,
      from: decodeMaybeBase64Utf8(row.encrypted_from),
      to: decodeRecipientList(row.encrypted_to),
      subject: decodeMaybeBase64Utf8(row.encrypted_subject),
      receivedAt: normalizeTimestamp(row.received_at),
      size: row.ciphertext_size ?? 0
    }));

    return { emails, total, offset, limit };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to list VFS emails:', error);
    throw new ConnectError('Failed to list emails', Code.Internal);
  }
}

export async function getEmailDirect(
  request: EmailIdRequest,
  context: { requestHeader: Headers }
): Promise<{
  id: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: string;
  size: number;
  rawData: string;
  encryptedBodyPath?: string;
}> {
  const emailId = request.id.trim();
  if (emailId.length === 0) {
    throw new ConnectError('id is required', Code.InvalidArgument);
  }

  const claims = await requireVfsClaims(
    VFS_V2_GET_EMAIL_CONNECT_PATH,
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const result = await pool.query<{
      id: string;
      encrypted_from: string | null;
      encrypted_to: unknown;
      encrypted_subject: string | null;
      received_at: string | Date;
      ciphertext_size: number | null;
      encrypted_body_path: string | null;
    }>(
      `SELECT
           e.id,
           e.encrypted_from,
           e.encrypted_to,
           e.encrypted_subject,
           e.received_at,
           e.encrypted_body_path,
           e.ciphertext_size
         FROM emails e
         INNER JOIN vfs_registry vr ON vr.id = e.id
         WHERE e.id = $1
           AND vr.owner_id = $2
         LIMIT 1`,
      [emailId, claims.sub]
    );

    const row = result.rows[0];
    if (!row) {
      throw new ConnectError('Email not found', Code.NotFound);
    }
    const scaffoldInlineBody = parseScaffoldInlineBody(row.encrypted_body_path);

    return {
      id: row.id,
      from: decodeMaybeBase64Utf8(row.encrypted_from),
      to: decodeRecipientList(row.encrypted_to),
      subject: decodeMaybeBase64Utf8(row.encrypted_subject),
      receivedAt: normalizeTimestamp(row.received_at),
      size: row.ciphertext_size ?? 0,
      rawData: scaffoldInlineBody ?? '',
      ...(scaffoldInlineBody === null &&
      typeof row.encrypted_body_path === 'string' &&
      row.encrypted_body_path.length > 0
        ? { encryptedBodyPath: row.encrypted_body_path }
        : {})
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to get VFS email:', error);
    throw new ConnectError('Failed to get email', Code.Internal);
  }
}

export async function deleteEmailDirect(
  request: EmailIdRequest,
  context: { requestHeader: Headers }
): Promise<{ success: boolean }> {
  const emailId = request.id.trim();
  if (emailId.length === 0) {
    throw new ConnectError('id is required', Code.InvalidArgument);
  }

  const claims = await requireVfsClaims(
    buildVfsV2ConnectMethodPath('DeleteEmail'),
    context.requestHeader,
    { requireDeclaredOrganization: true }
  );

  try {
    const pool = await getPostgresPool();
    const client = await pool.connect();
    let orphanedStorageKey: string | null = null;

    try {
      await client.query('BEGIN');
      const emailRowResult = await client.query<{ storage_key: string | null }>(
        `SELECT
             e.encrypted_body_path AS storage_key
           FROM vfs_registry vr
           INNER JOIN emails e ON e.id = vr.id
           WHERE vr.id = $1
             AND vr.owner_id = $2
             AND vr.object_type = 'email'
           LIMIT 1`,
        [emailId, claims.sub]
      );

      const emailRow = emailRowResult.rows[0];
      if (!emailRow) {
        await client.query('ROLLBACK');
        throw new ConnectError('Email not found', Code.NotFound);
      }

      const deleted = await client.query<{ id: string }>(
        `DELETE FROM vfs_registry
           WHERE id = $1
             AND owner_id = $2
             AND object_type = 'email'
           RETURNING id`,
        [emailId, claims.sub]
      );

      if (!deleted.rows[0]) {
        await client.query('ROLLBACK');
        throw new ConnectError('Email not found', Code.NotFound);
      }

      if (emailRow.storage_key) {
        const remainingItems = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM emails
             WHERE encrypted_body_path = $1`,
          [emailRow.storage_key]
        );

        const remainingCount =
          parseInt(remainingItems.rows[0]?.count ?? '0', 10) || 0;
        if (remainingCount === 0) {
          orphanedStorageKey = emailRow.storage_key;
        }
      }

      await client.query('COMMIT');
    } catch (transactionError) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(
          'Failed to rollback VFS email delete transaction:',
          rollbackError
        );
      }
      throw transactionError;
    } finally {
      client.release();
    }

    if (orphanedStorageKey) {
      try {
        await deleteVfsBlobByStorageKey({ storageKey: orphanedStorageKey });
      } catch (blobDeleteError) {
        console.error(
          'Failed to delete orphaned inbound email blob:',
          blobDeleteError
        );
      }
    }

    return { success: true };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to delete VFS email:', error);
    throw new ConnectError('Failed to delete email', Code.Internal);
  }
}

export async function sendEmailDirect(
  request: SendEmailRequest,
  context: { requestHeader: Headers }
): Promise<{ success: boolean; messageId?: string }> {
  await requireVfsClaims(
    VFS_V2_SEND_EMAIL_CONNECT_PATH,
    context.requestHeader,
    { requireDeclaredOrganization: true }
  );

  try {
    const payload = parseSendRequestPayload(request);

    const emailAttachments: EmailAttachment[] | undefined =
      payload.attachments?.map((attachment) => ({
        filename: attachment.fileName,
        content: Buffer.from(attachment.content, 'base64'),
        contentType: attachment.mimeType
      }));

    const result = await sendEmail({
      to: payload.to,
      ...(payload.cc ? { cc: payload.cc } : {}),
      ...(payload.bcc ? { bcc: payload.bcc } : {}),
      subject: payload.subject,
      text: payload.body,
      ...(emailAttachments ? { attachments: emailAttachments } : {})
    });

    if (!result.success) {
      throw new ConnectError(
        result.error ?? 'Failed to send email',
        Code.Internal
      );
    }

    return {
      success: true,
      ...(result.messageId ? { messageId: result.messageId } : {})
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to send VFS email:', error);
    throw new ConnectError('Failed to send email', Code.Internal);
  }
}
