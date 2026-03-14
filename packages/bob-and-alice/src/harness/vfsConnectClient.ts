import type { VfsCrdtSyncResponse, VfsSyncResponse } from '@tearleads/shared';
import {
  createConnectJsonPostInit,
  isPlainRecord,
  normalizeVfsCrdtSyncConnectPayload,
  normalizeVfsSyncConnectPayload,
  parseConnectJsonEnvelopeBody,
  VFS_V2_CONNECT_BASE_PATH
} from '@tearleads/shared';

interface ConnectJsonApiActor {
  fetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

function unwrapConnectPayload(payload: unknown): unknown {
  let current = parseConnectJsonEnvelopeBody(payload);
  const maxResultUnwrapDepth = 8;
  let resultUnwrapDepth = 0;

  while (
    isPlainRecord(current) &&
    'result' in current &&
    current['result'] !== undefined
  ) {
    if (resultUnwrapDepth >= maxResultUnwrapDepth) {
      throw new Error('transport returned cyclic connect result wrapper');
    }
    current = parseConnectJsonEnvelopeBody(current['result']);
    resultUnwrapDepth += 1;
  }

  if (
    isPlainRecord(current) &&
    Object.keys(current).length === 1 &&
    (('response' in current && current['response'] !== undefined) ||
      ('message' in current && current['message'] !== undefined) ||
      ('value' in current && current['value'] !== undefined) ||
      ('json' in current && current['json'] !== undefined))
  ) {
    throw new Error('transport returned unsupported connect wrapper payload');
  }

  return current;
}

export async function fetchVfsConnectJson(input: {
  actor: ConnectJsonApiActor;
  methodName: 'GetSync';
  requestBody?: Record<string, unknown>;
}): Promise<VfsSyncResponse>;
export async function fetchVfsConnectJson(input: {
  actor: ConnectJsonApiActor;
  methodName: 'GetCrdtSync';
  requestBody?: Record<string, unknown>;
}): Promise<VfsCrdtSyncResponse>;
export async function fetchVfsConnectJson<TResponse>(input: {
  actor: ConnectJsonApiActor;
  methodName: string;
  requestBody?: Record<string, unknown>;
}): Promise<TResponse>;
export async function fetchVfsConnectJson(input: {
  actor: ConnectJsonApiActor;
  methodName: string;
  requestBody?: Record<string, unknown>;
}): Promise<VfsSyncResponse | VfsCrdtSyncResponse | Record<string, unknown>> {
  const envelope = await input.actor.fetchJson<unknown>(
    `${VFS_V2_CONNECT_BASE_PATH}/${input.methodName}`,
    createConnectJsonPostInit(input.requestBody ?? {})
  );
  const parsedPayload = unwrapConnectPayload(envelope);
  if (input.methodName === 'GetSync') {
    return normalizeVfsSyncConnectPayload(parsedPayload);
  }
  if (input.methodName === 'GetCrdtSync') {
    return normalizeVfsCrdtSyncConnectPayload(parsedPayload);
  }
  if (isPlainRecord(parsedPayload)) {
    return parsedPayload;
  }
  throw new Error('transport returned non-object connect payload');
}
