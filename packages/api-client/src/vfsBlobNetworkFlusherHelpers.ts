import type { VfsCrdtLastReconciledWriteIds } from '@tearleads/vfs-sync/vfs';
import type {
  VfsBlobAttachConsistency,
  VfsBlobNetworkOperation,
  VfsBlobRelationKind
} from './vfsBlobNetworkFlusherTypes';

export { fetchWithAuthRefresh } from './vfsAuthFetch';

const VALID_BLOB_RELATION_KINDS: VfsBlobRelationKind[] = [
  'file',
  'emailAttachment',
  'photo',
  'other'
];

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return '';
  }

  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

export function normalizeApiPrefix(apiPrefix: string): string {
  const trimmed = apiPrefix.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

export function parseErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null) {
    return fallback;
  }

  const value = body as { error?: unknown; message?: unknown };
  if (typeof value.error === 'string' && value.error.length > 0) {
    return value.error;
  }
  if (typeof value.message === 'string' && value.message.length > 0) {
    return value.message;
  }

  return fallback;
}

export function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeIsoTimestamp(value: unknown): string | null {
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

export function isValidLastReconciledWriteIds(
  value: unknown
): value is VfsCrdtLastReconciledWriteIds {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);
  for (const [replicaId, writeId] of entries) {
    if (normalizeRequiredString(replicaId) === null) {
      return false;
    }
    if (
      typeof writeId !== 'number' ||
      !Number.isInteger(writeId) ||
      writeId < 0 ||
      !Number.isFinite(writeId)
    ) {
      return false;
    }
  }

  return true;
}

export function isBlobRelationKind(
  value: unknown
): value is VfsBlobRelationKind {
  return (
    typeof value === 'string' &&
    VALID_BLOB_RELATION_KINDS.some((candidate) => candidate === value)
  );
}

export function cloneOperation(
  operation: VfsBlobNetworkOperation
): VfsBlobNetworkOperation {
  if (operation.kind === 'stage') {
    return {
      ...operation,
      payload: {
        stagingId: operation.payload.stagingId,
        blobId: operation.payload.blobId,
        expiresAt: operation.payload.expiresAt
      }
    };
  }

  if (operation.kind === 'abandon') {
    return {
      ...operation,
      payload: {
        stagingId: operation.payload.stagingId
      }
    };
  }

  return {
    ...operation,
    payload: {
      stagingId: operation.payload.stagingId,
      itemId: operation.payload.itemId,
      relationKind: operation.payload.relationKind,
      consistency: operation.payload.consistency
        ? {
            clientId: operation.payload.consistency.clientId,
            requiredCursor: {
              changedAt: operation.payload.consistency.requiredCursor.changedAt,
              changeId: operation.payload.consistency.requiredCursor.changeId
            },
            requiredLastReconciledWriteIds: {
              ...operation.payload.consistency.requiredLastReconciledWriteIds
            }
          }
        : undefined
    }
  };
}

export function cloneOperations(
  operations: VfsBlobNetworkOperation[]
): VfsBlobNetworkOperation[] {
  return operations.map((operation) => cloneOperation(operation));
}

export function createOperationId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `blob-op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeAttachConsistency(
  consistency: VfsBlobAttachConsistency | undefined
): VfsBlobAttachConsistency | undefined {
  if (!consistency) {
    return undefined;
  }

  const clientId = normalizeRequiredString(consistency.clientId);
  if (!clientId || clientId.includes(':')) {
    throw new Error('consistency.clientId is invalid');
  }

  const requiredCursor = consistency.requiredCursor;
  const changedAt = normalizeIsoTimestamp(requiredCursor.changedAt);
  const changeId = normalizeRequiredString(requiredCursor.changeId);
  if (!changedAt || !changeId) {
    throw new Error('consistency.requiredCursor is invalid');
  }

  if (
    !isValidLastReconciledWriteIds(consistency.requiredLastReconciledWriteIds)
  ) {
    throw new Error('consistency.requiredLastReconciledWriteIds is invalid');
  }

  return {
    clientId,
    requiredCursor: {
      changedAt,
      changeId
    },
    requiredLastReconciledWriteIds: {
      ...consistency.requiredLastReconciledWriteIds
    }
  };
}
