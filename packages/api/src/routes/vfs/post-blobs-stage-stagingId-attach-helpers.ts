import { isRecord } from '@tearleads/shared';
import {
  decodeVfsSyncCursor,
  parseVfsCrdtLastReconciledWriteIds,
  type VfsCrdtLastReconciledWriteIds,
  type VfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import { normalizeRequiredString } from './blob-shared.js';

interface ParsedBlobAttachConsistency {
  clientId: string;
  requiredCursor: VfsSyncCursor;
  requiredLastReconciledWriteIds: VfsCrdtLastReconciledWriteIds;
}

type ParseBlobAttachConsistencyResult =
  | {
      ok: true;
      value: ParsedBlobAttachConsistency | null;
    }
  | {
      ok: false;
      error: string;
    };

const CRDT_CLIENT_NAMESPACE = 'crdt';
const BLOB_LINK_SESSION_KEY_PREFIX = 'blob-link:';

export function toScopedCrdtClientId(clientId: string): string {
  return `${CRDT_CLIENT_NAMESPACE}:${clientId}`;
}

export function toBlobLinkSessionKey(relationKind: string): string {
  return `${BLOB_LINK_SESSION_KEY_PREFIX}${relationKind}`;
}

export function parseBlobLinkRelationKind(value: unknown): string | null {
  if (isRecord(value)) {
    return normalizeRequiredString(value['relationKind']);
  }

  return null;
}

export function parseBlobLinkRelationKindFromSessionKey(
  value: unknown
): string | null {
  const normalized = normalizeRequiredString(value);
  if (!normalized || !normalized.startsWith(BLOB_LINK_SESSION_KEY_PREFIX)) {
    return null;
  }

  const relationKind = normalized.slice(BLOB_LINK_SESSION_KEY_PREFIX.length);
  return relationKind.length > 0 ? relationKind : null;
}

export function dominatesLastWriteIds(
  current: VfsCrdtLastReconciledWriteIds,
  required: VfsCrdtLastReconciledWriteIds
): boolean {
  for (const [replicaId, requiredWriteId] of Object.entries(required)) {
    const currentWriteId = current[replicaId] ?? 0;
    if (currentWriteId < requiredWriteId) {
      return false;
    }
  }

  return true;
}

export function parseBlobAttachConsistency(
  body: unknown
): ParseBlobAttachConsistencyResult {
  if (!isRecord(body)) {
    return {
      ok: true,
      value: null
    };
  }

  const rawClientId = body['clientId'];
  const rawRequiredCursor = body['requiredCursor'];
  const rawRequiredLastWriteIds = body['requiredLastReconciledWriteIds'];

  if (
    rawClientId === undefined &&
    rawRequiredCursor === undefined &&
    rawRequiredLastWriteIds === undefined
  ) {
    return {
      ok: true,
      value: null
    };
  }

  const clientId = normalizeRequiredString(rawClientId);
  if (!clientId) {
    return {
      ok: false,
      error: 'clientId is required when reconcile guardrails are provided'
    };
  }

  /**
   * Guardrail: ':' is the namespace delimiter for persisted client IDs.
   * Rejecting it here avoids aliasing between scoped and unscoped IDs.
   */
  if (clientId.includes(':')) {
    return {
      ok: false,
      error: 'clientId must not contain ":"'
    };
  }

  const requiredCursorRaw = normalizeRequiredString(rawRequiredCursor);
  if (!requiredCursorRaw) {
    return {
      ok: false,
      error: 'requiredCursor is required when reconcile guardrails are provided'
    };
  }

  const requiredCursor = decodeVfsSyncCursor(requiredCursorRaw);
  if (!requiredCursor) {
    return {
      ok: false,
      error: 'Invalid requiredCursor'
    };
  }

  const parsedLastWriteIds = parseVfsCrdtLastReconciledWriteIds(
    rawRequiredLastWriteIds
  );
  if (!parsedLastWriteIds.ok) {
    return {
      ok: false,
      error: parsedLastWriteIds.error
    };
  }

  return {
    ok: true,
    value: {
      clientId,
      requiredCursor,
      requiredLastReconciledWriteIds: parsedLastWriteIds.value
    }
  };
}
