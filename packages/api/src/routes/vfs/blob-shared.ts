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

interface ParsedBlobChunkBody {
  uploadId: string;
  chunkIndex: number;
  isFinal: boolean;
  nonce: string;
  aadHash: string;
  ciphertextBase64: string;
  plaintextLength: number;
  ciphertextLength: number;
}

export function parseBlobChunkBody(body: unknown): ParsedBlobChunkBody | null {
  if (!isRecord(body)) {
    return null;
  }

  const uploadId = normalizeRequiredString(body['uploadId']);
  const nonce = normalizeRequiredString(body['nonce']);
  const aadHash = normalizeRequiredString(body['aadHash']);
  const ciphertextBase64 = normalizeRequiredString(body['ciphertextBase64']);
  const chunkIndexValue = body['chunkIndex'];
  const isFinal = body['isFinal'];
  const plaintextLengthValue = body['plaintextLength'];
  const ciphertextLengthValue = body['ciphertextLength'];

  if (
    typeof chunkIndexValue !== 'number' ||
    typeof plaintextLengthValue !== 'number' ||
    typeof ciphertextLengthValue !== 'number'
  ) {
    return null;
  }

  const chunkIndex = chunkIndexValue;
  const plaintextLength = plaintextLengthValue;
  const ciphertextLength = ciphertextLengthValue;

  if (
    !uploadId ||
    !nonce ||
    !aadHash ||
    !ciphertextBase64 ||
    !Number.isInteger(chunkIndex) ||
    chunkIndex < 0 ||
    typeof isFinal !== 'boolean' ||
    !Number.isInteger(plaintextLength) ||
    plaintextLength < 0 ||
    !Number.isInteger(ciphertextLength) ||
    ciphertextLength < 0
  ) {
    return null;
  }

  return {
    uploadId,
    chunkIndex,
    isFinal,
    nonce,
    aadHash,
    ciphertextBase64,
    plaintextLength,
    ciphertextLength
  };
}

interface ParsedBlobCommitBody {
  uploadId: string;
  keyEpoch: number;
  manifestHash: string;
  manifestSignature: string;
  chunkCount: number;
  totalPlaintextBytes: number;
  totalCiphertextBytes: number;
}

export function parseBlobCommitBody(
  body: unknown
): ParsedBlobCommitBody | null {
  if (!isRecord(body)) {
    return null;
  }

  const uploadId = normalizeRequiredString(body['uploadId']);
  const manifestHash = normalizeRequiredString(body['manifestHash']);
  const manifestSignature = normalizeRequiredString(body['manifestSignature']);
  const keyEpochValue = body['keyEpoch'];
  const chunkCountValue = body['chunkCount'];
  const totalPlaintextBytesValue = body['totalPlaintextBytes'];
  const totalCiphertextBytesValue = body['totalCiphertextBytes'];

  if (
    typeof keyEpochValue !== 'number' ||
    typeof chunkCountValue !== 'number' ||
    typeof totalPlaintextBytesValue !== 'number' ||
    typeof totalCiphertextBytesValue !== 'number'
  ) {
    return null;
  }

  const keyEpoch = keyEpochValue;
  const chunkCount = chunkCountValue;
  const totalPlaintextBytes = totalPlaintextBytesValue;
  const totalCiphertextBytes = totalCiphertextBytesValue;

  if (
    !uploadId ||
    !manifestHash ||
    !manifestSignature ||
    !Number.isInteger(keyEpoch) ||
    keyEpoch < 1 ||
    !Number.isInteger(chunkCount) ||
    chunkCount < 1 ||
    !Number.isInteger(totalPlaintextBytes) ||
    totalPlaintextBytes < 0 ||
    !Number.isInteger(totalCiphertextBytes) ||
    totalCiphertextBytes < 0
  ) {
    return null;
  }

  return {
    uploadId,
    keyEpoch,
    manifestHash,
    manifestSignature,
    chunkCount,
    totalPlaintextBytes,
    totalCiphertextBytes
  };
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
