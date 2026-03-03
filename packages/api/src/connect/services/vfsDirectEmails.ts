import { Buffer } from 'node:buffer';
import { Code, ConnectError } from '@connectrpc/connect';
import { type EmailAttachment, sendEmail } from '../../lib/emailSender.js';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import { deleteVfsBlobByStorageKey } from '../../lib/vfsBlobStore.js';
import { encoded, isRecord, parseJsonBody } from './vfsDirectJson.js';
import { requireVfsClaims } from './vfsDirectAuth.js';

type GetEmailsRequest = { offset: number; limit: number };
type EmailIdRequest = { id: string };
type JsonRequest = { json: string };

interface EmailListItem {
  id: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: string;
  size: number;
}

interface SendAttachmentRequest {
  fileName: string;
  mimeType: string;
  content: string;
}

interface SendRequestPayload {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments?: SendAttachmentRequest[];
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

function parseSendRequestPayload(body: unknown): SendRequestPayload {
  if (!isRecord(body)) {
    throw new ConnectError('Invalid JSON body', Code.InvalidArgument);
  }

  const to = toStringArray(body['to']);
  if (to.length === 0) {
    throw new ConnectError('At least one recipient is required', Code.InvalidArgument);
  }

  const subjectValue = body['subject'];
  if (typeof subjectValue !== 'string' || subjectValue.trim().length === 0) {
    throw new ConnectError('Subject is required', Code.InvalidArgument);
  }

  const bodyValue = body['body'];
  const textBody = typeof bodyValue === 'string' ? bodyValue : '';

  const ccValues = toStringArray(body['cc']);
  const bccValues = toStringArray(body['bcc']);

  const attachmentsValue = body['attachments'];
  let attachments: SendAttachmentRequest[] | undefined;
  if (attachmentsValue !== undefined) {
    if (!Array.isArray(attachmentsValue)) {
      throw new ConnectError('attachments must be an array', Code.InvalidArgument);
    }

    const parsedAttachments: SendAttachmentRequest[] = [];
    for (const attachmentValue of attachmentsValue) {
      if (!isRecord(attachmentValue)) {
        throw new ConnectError('Invalid attachment payload', Code.InvalidArgument);
      }

      const fileName = attachmentValue['fileName'];
      const mimeType = attachmentValue['mimeType'];
      const content = attachmentValue['content'];

      if (
        typeof fileName !== 'string' ||
        typeof mimeType !== 'string' ||
        typeof content !== 'string'
      ) {
        throw new ConnectError('Invalid attachment payload', Code.InvalidArgument);
      }

      parsedAttachments.push({
        fileName,
        mimeType,
        content
      });
    }

    attachments = parsedAttachments;
  }

  return {
    to,
    ...(ccValues.length > 0 ? { cc: ccValues } : {}),
    ...(bccValues.length > 0 ? { bcc: bccValues } : {}),
    subject: subjectValue,
    body: textBody,
    ...(attachments ? { attachments } : {})
  };
}

export async function getEmailsDirect(
  request: GetEmailsRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireVfsClaims('/vfs/emails', context.requestHeader);

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
      received_at: string;
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
      from: row.encrypted_from ?? '',
      to: toStringArray(row.encrypted_to),
      subject: row.encrypted_subject ?? '',
      receivedAt: row.received_at,
      size: row.ciphertext_size ?? 0
    }));

    return {
      json: JSON.stringify({ emails, total, offset, limit })
    };
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
): Promise<{ json: string }> {
  const emailId = request.id.trim();
  if (emailId.length === 0) {
    throw new ConnectError('id is required', Code.InvalidArgument);
  }

  const claims = await requireVfsClaims(
    `/vfs/emails/${encoded(emailId)}`,
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const result = await pool.query<{
      id: string;
      encrypted_from: string | null;
      encrypted_to: unknown;
      encrypted_subject: string | null;
      received_at: string;
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

    return {
      json: JSON.stringify({
        id: row.id,
        from: row.encrypted_from ?? '',
        to: toStringArray(row.encrypted_to),
        subject: row.encrypted_subject ?? '',
        receivedAt: row.received_at,
        size: row.ciphertext_size ?? 0,
        rawData: '',
        encryptedBodyPath: row.encrypted_body_path ?? null
      })
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
): Promise<{ json: string }> {
  const emailId = request.id.trim();
  if (emailId.length === 0) {
    throw new ConnectError('id is required', Code.InvalidArgument);
  }

  const claims = await requireVfsClaims(
    `/vfs/emails/${encoded(emailId)}`,
    context.requestHeader
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

        const remainingCount = parseInt(remainingItems.rows[0]?.count ?? '0', 10) || 0;
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
        console.error('Failed to delete orphaned inbound email blob:', blobDeleteError);
      }
    }

    return {
      json: JSON.stringify({ success: true })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to delete VFS email:', error);
    throw new ConnectError('Failed to delete email', Code.Internal);
  }
}

export async function sendEmailDirect(
  request: JsonRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  await requireVfsClaims('/vfs/emails/send', context.requestHeader);

  try {
    const payload = parseSendRequestPayload(parseJsonBody(request.json));

    const emailAttachments: EmailAttachment[] | undefined = payload.attachments?.map(
      (attachment) => ({
        filename: attachment.fileName,
        content: Buffer.from(attachment.content, 'base64'),
        contentType: attachment.mimeType
      })
    );

    const result = await sendEmail({
      to: payload.to,
      ...(payload.cc ? { cc: payload.cc } : {}),
      ...(payload.bcc ? { bcc: payload.bcc } : {}),
      subject: payload.subject,
      text: payload.body,
      ...(emailAttachments ? { attachments: emailAttachments } : {})
    });

    if (!result.success) {
      throw new ConnectError(result.error ?? 'Failed to send email', Code.Internal);
    }

    return {
      json: JSON.stringify({
        success: true,
        messageId: result.messageId
      })
    };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }

    console.error('Failed to send VFS email:', error);
    throw new ConnectError('Failed to send email', Code.Internal);
  }
}
