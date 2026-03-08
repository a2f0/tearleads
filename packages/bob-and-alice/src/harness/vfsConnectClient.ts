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

  for (let depth = 0; depth < 8; depth += 1) {
    if (!isPlainRecord(current)) {
      return current;
    }

    if ('result' in current && current['result'] !== undefined) {
      current = parseConnectJsonEnvelopeBody(current['result']);
      continue;
    }

    if ('response' in current && current['response'] !== undefined) {
      current = parseConnectJsonEnvelopeBody(current['response']);
      continue;
    }

    if ('message' in current && current['message'] !== undefined) {
      current = parseConnectJsonEnvelopeBody(current['message']);
      continue;
    }

    if (
      'value' in current &&
      current['value'] !== undefined &&
      Object.keys(current).length === 1
    ) {
      current = parseConnectJsonEnvelopeBody(current['value']);
      continue;
    }

    if ('json' in current && current['json'] !== undefined) {
      current = parseConnectJsonEnvelopeBody(current['json']);
      continue;
    }

    return current;
  }

  return current;
}

function normalizeLastReconciledWriteIds(value: unknown): Record<string, number> {
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

function normalizeSyncPagePayload(payload: unknown, methodName: string): unknown {
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
  if (typeof payload === 'string') {
    return parseConnectJsonString<T>(payload);
  }
  if (payload === null || payload === undefined) {
    return parseConnectJsonString<T>('{}');
  }
  try {
    return parseConnectJsonString<T>(JSON.stringify(payload));
  } catch {
    return parseConnectJsonString<T>('{}');
  }
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
  const normalizedPayload = normalizeSyncPagePayload(parsedPayload, input.methodName);
  return toParsedJson<T>(normalizedPayload);
}
