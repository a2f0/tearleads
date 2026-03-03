import {
  createConnectJsonPostInit,
  parseConnectJsonString
} from '@tearleads/shared';

const VFS_CONNECT_BASE_PATH = '/connect/tearleads.v1.VfsService';

interface ConnectJsonEnvelopeResponse {
  json?: unknown;
}

interface ConnectJsonApiActor {
  fetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

export async function fetchVfsConnectJson<T>(input: {
  actor: ConnectJsonApiActor;
  methodName: string;
  requestBody?: Record<string, unknown>;
}): Promise<T> {
  const envelope = await input.actor.fetchJson<ConnectJsonEnvelopeResponse>(
    `${VFS_CONNECT_BASE_PATH}/${input.methodName}`,
    createConnectJsonPostInit(input.requestBody ?? {})
  );
  return parseConnectJsonString<T>(envelope.json);
}
