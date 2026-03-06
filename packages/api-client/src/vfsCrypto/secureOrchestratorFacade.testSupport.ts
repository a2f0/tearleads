import { VFS_V2_CONNECT_BASE_PATH as VFS_CONNECT_BASE_PATH } from '@tearleads/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBody(bodyText: string): unknown {
  if (bodyText.trim().length === 0) {
    return null;
  }
  return JSON.parse(bodyText);
}

function parseConnectJsonEnvelope(payload: unknown): unknown {
  if (!isRecord(payload) || typeof payload['json'] !== 'string') {
    return payload;
  }

  const rawJson = payload['json'];
  if (rawJson.trim().length === 0) {
    return {};
  }

  return JSON.parse(rawJson);
}

async function readPushBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<unknown> {
  if (typeof init?.body === 'string') {
    return parseConnectJsonEnvelope(parseBody(init.body));
  }

  if (input instanceof Request) {
    const cloned = input.clone();
    const bodyText = await cloned.text();
    if (bodyText.trim().length > 0) {
      return parseConnectJsonEnvelope(parseBody(bodyText));
    }
  }

  return null;
}

export async function recordSecureFacadeRequestBody(
  requests: Array<{ url: string; body: unknown }>,
  url: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<void> {
  if (url.endsWith(`${VFS_CONNECT_BASE_PATH}/PushCrdtOps`)) {
    const pushBody = await readPushBody(input, init);
    if (pushBody) {
      requests.push({
        url,
        body: pushBody
      });
      return;
    }
  }

  if (typeof init?.body === 'string') {
    requests.push({ url, body: JSON.parse(init.body) });
  }
}
