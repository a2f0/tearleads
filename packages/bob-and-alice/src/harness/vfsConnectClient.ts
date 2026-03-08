import {
  createConnectJsonPostInit,
  isPlainRecord,
  parseConnectJsonEnvelopeBody,
  parseConnectJsonString,
  VFS_V2_CONNECT_BASE_PATH
} from '@tearleads/shared';

interface ConnectJsonEnvelopeResponse {
  json?: unknown;
}

interface ConnectJsonApiActor {
  fetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

function unwrapConnectPayload(payload: unknown): unknown {
  let current = parseConnectJsonEnvelopeBody(payload);

  for (let depth = 0; depth < 4; depth += 1) {
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

    return current;
  }

  return current;
}

function applyConnectMethodDefaults(
  methodName: string,
  payload: unknown
): unknown {
  if (!isPlainRecord(payload)) {
    return payload;
  }

  if (methodName === 'GetSync') {
    return {
      items: [],
      hasMore: false,
      ...payload
    };
  }

  if (methodName === 'GetCrdtSync') {
    return {
      items: [],
      hasMore: false,
      nextCursor: null,
      lastReconciledWriteIds: {},
      ...payload
    };
  }

  return payload;
}

export async function fetchVfsConnectJson<T>(input: {
  actor: ConnectJsonApiActor;
  methodName: string;
  requestBody?: Record<string, unknown>;
}): Promise<T> {
  const envelope = await input.actor.fetchJson<ConnectJsonEnvelopeResponse>(
    `${VFS_V2_CONNECT_BASE_PATH}/${input.methodName}`,
    createConnectJsonPostInit(input.requestBody ?? {})
  );
  const parsedBody = applyConnectMethodDefaults(
    input.methodName,
    unwrapConnectPayload(envelope)
  );
  if (typeof parsedBody === 'string') {
    return parseConnectJsonString<T>(parsedBody);
  }
  return parseConnectJsonString<T>(JSON.stringify(parsedBody));
}
