import { Code, ConnectError } from '@connectrpc/connect';
import { isRecord } from './vfsDirectJson.js';

export interface SendAttachmentRequest {
  fileName: string;
  mimeType: string;
  content: string;
}

export interface SendRequestPayload {
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

export function parseSendRequestPayload(body: unknown): SendRequestPayload {
  if (!isRecord(body)) {
    throw new ConnectError('Invalid JSON body', Code.InvalidArgument);
  }

  const to = toStringArray(body['to']);
  if (to.length === 0) {
    throw new ConnectError(
      'At least one recipient is required',
      Code.InvalidArgument
    );
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
      throw new ConnectError(
        'attachments must be an array',
        Code.InvalidArgument
      );
    }

    const parsedAttachments: SendAttachmentRequest[] = [];
    for (const attachmentValue of attachmentsValue) {
      if (!isRecord(attachmentValue)) {
        throw new ConnectError(
          'Invalid attachment payload',
          Code.InvalidArgument
        );
      }

      const fileName = attachmentValue['fileName'];
      const mimeType = attachmentValue['mimeType'];
      const content = attachmentValue['content'];

      if (
        typeof fileName !== 'string' ||
        typeof mimeType !== 'string' ||
        typeof content !== 'string'
      ) {
        throw new ConnectError(
          'Invalid attachment payload',
          Code.InvalidArgument
        );
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
