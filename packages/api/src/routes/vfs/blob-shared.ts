import { randomUUID } from 'node:crypto';
import { isRecord } from '@tearleads/shared';

type VfsBlobRelationKind = 'file' | 'emailAttachment' | 'photo' | 'other';

const VALID_RELATION_KINDS: VfsBlobRelationKind[] = [
  'file',
  'emailAttachment',
  'photo',
  'other'
];

export function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOptionalString(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return normalizeRequiredString(value);
}

export function parseIsoTimestamp(value: unknown): string | null {
  const normalized = normalizeRequiredString(value);
  if (!normalized) {
    return null;
  }

  const parsedMs = Date.parse(normalized);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString();
}

export function parseBlobStageBody(body: unknown): {
  stagingId: string;
  blobId: string;
  expiresAt: string;
  dataBase64: string | null;
  contentType: string | null;
} | null {
  if (!isRecord(body)) {
    return null;
  }

  const blobId = normalizeRequiredString(body['blobId']);
  const expiresAt = parseIsoTimestamp(body['expiresAt']);
  if (!blobId || !expiresAt) {
    return null;
  }

  const dataBase64 = normalizeOptionalString(body['dataBase64']);
  if (body['dataBase64'] !== undefined && dataBase64 === null) {
    return null;
  }

  const contentType = normalizeOptionalString(body['contentType']);
  if (body['contentType'] !== undefined && contentType === null) {
    return null;
  }

  const stagingId = normalizeOptionalString(body['stagingId']) ?? randomUUID();

  return {
    stagingId,
    blobId,
    expiresAt,
    dataBase64,
    contentType
  };
}

export function parseBlobAttachBody(body: unknown): {
  itemId: string;
  relationKind: VfsBlobRelationKind;
} | null {
  if (!isRecord(body)) {
    return null;
  }

  const itemId = normalizeRequiredString(body['itemId']);
  if (!itemId) {
    return null;
  }

  const relationKindRaw = body['relationKind'];
  if (relationKindRaw === undefined) {
    return {
      itemId,
      relationKind: 'file'
    };
  }

  if (typeof relationKindRaw !== 'string') {
    return null;
  }

  for (const relationKind of VALID_RELATION_KINDS) {
    if (relationKind === relationKindRaw) {
      return {
        itemId,
        relationKind
      };
    }
  }

  return null;
}

export function toIsoFromDateOrString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

export function isPostgresErrorWithCode(
  error: unknown,
  code: string
): error is { code: string } {
  return isRecord(error) && error['code'] === code;
}
