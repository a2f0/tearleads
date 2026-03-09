import {
  createConnectJsonPostInit,
  isPlainRecord,
  parseConnectJsonEnvelopeBody,
  parseConnectJsonString,
  VFS_V2_CONNECT_BASE_PATH
} from '@tearleads/shared';

interface ConnectJsonApiActor {
  fetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

function unwrapConnectPayload(payload: unknown): unknown {
  let current = parseConnectJsonEnvelopeBody(payload);

  while (
    isPlainRecord(current) &&
    Object.keys(current).length === 1 &&
    'result' in current &&
    current['result'] !== undefined
  ) {
    current = parseConnectJsonEnvelopeBody(current['result']);
  }

  if (
    isPlainRecord(current) &&
    Object.keys(current).length === 1 &&
    (('response' in current && current['response'] !== undefined) ||
      ('message' in current && current['message'] !== undefined) ||
      ('value' in current && current['value'] !== undefined))
  ) {
    throw new Error('transport returned unsupported connect wrapper payload');
  }

  return current;
}

function normalizeLastReconciledWriteIds(
  value: unknown
): Record<string, number> {
  if (!isPlainRecord(value)) {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [replicaId, writeId] of Object.entries(value)) {
    const trimmedReplicaId = replicaId.trim();
    if (trimmedReplicaId.length === 0) {
      continue;
    }
    if (
      typeof writeId !== 'number' ||
      !Number.isInteger(writeId) ||
      !Number.isSafeInteger(writeId) ||
      writeId < 1
    ) {
      continue;
    }

    normalized[trimmedReplicaId] = writeId;
  }

  return normalized;
}

function normalizeSyncPagePayload(
  payload: unknown,
  methodName: string
): unknown {
  if (methodName !== 'GetSync' && methodName !== 'GetCrdtSync') {
    return payload;
  }

  const recordPayload = isPlainRecord(payload) ? payload : {};
  const rawItems = recordPayload['items'];
  const rawNextCursor = recordPayload['nextCursor'];
  const rawHasMore = recordPayload['hasMore'];

  const items = Array.isArray(rawItems) ? rawItems : [];
  const nextCursor =
    typeof rawNextCursor === 'string' && rawNextCursor.trim().length > 0
      ? rawNextCursor
      : null;
  const hasMore = rawHasMore === true;

  if (methodName === 'GetSync') {
    return {
      ...recordPayload,
      items,
      nextCursor,
      hasMore
    };
  }

  return {
    ...recordPayload,
    items,
    nextCursor,
    hasMore,
    lastReconciledWriteIds: normalizeLastReconciledWriteIds(
      recordPayload['lastReconciledWriteIds']
    )
  };
}

function toParsedJson<T>(payload: unknown): T {
  if (isPlainRecord(payload)) {
    return parseConnectJsonString<T>(JSON.stringify(payload));
  }

  // Harness transport should always decode to an object payload.
  throw new Error('transport returned non-object connect payload');
}

export async function fetchVfsConnectJson<T>(input: {
  actor: ConnectJsonApiActor;
  methodName: string;
  requestBody?: Record<string, unknown>;
}): Promise<T> {
  const envelope = await input.actor.fetchJson<unknown>(
    `${VFS_V2_CONNECT_BASE_PATH}/${input.methodName}`,
    createConnectJsonPostInit(input.requestBody ?? {})
  );
  const parsedPayload = unwrapConnectPayload(envelope);
  const normalizedPayload = normalizeSyncPagePayload(
    parsedPayload,
    input.methodName
  );
  return toParsedJson<T>(normalizedPayload);
}
