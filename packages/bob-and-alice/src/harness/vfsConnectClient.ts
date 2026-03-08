import {
  createConnectJsonPostInit,
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

export async function fetchVfsConnectJson<T>(input: {
  actor: ConnectJsonApiActor;
  methodName: string;
  requestBody?: Record<string, unknown>;
}): Promise<T> {
  const envelope = await input.actor.fetchJson<ConnectJsonEnvelopeResponse>(
    `${VFS_V2_CONNECT_BASE_PATH}/${input.methodName}`,
    createConnectJsonPostInit(input.requestBody ?? {})
  );
  const parsedBody = parseConnectJsonEnvelopeBody(envelope);
  if (typeof parsedBody === 'string') {
    return parseConnectJsonString<T>(parsedBody);
  }
  return parseConnectJsonString<T>(JSON.stringify(parsedBody));
}
