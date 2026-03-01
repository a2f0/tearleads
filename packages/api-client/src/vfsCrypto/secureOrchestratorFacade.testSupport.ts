import { decodeVfsCrdtPushRequestProtobuf } from '@tearleads/vfs-sync/vfs';

async function readPushBodyBytes(
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<Uint8Array | null> {
  if (init?.body instanceof Uint8Array) {
    return init.body;
  }

  if (init?.body instanceof ArrayBuffer) {
    return new Uint8Array(init.body);
  }

  if (init?.body && ArrayBuffer.isView(init.body)) {
    return new Uint8Array(
      init.body.buffer,
      init.body.byteOffset,
      init.body.byteLength
    );
  }

  if (input instanceof Request) {
    const cloned = input.clone();
    const bodyBuffer = await cloned.arrayBuffer();
    if (bodyBuffer.byteLength > 0) {
      return new Uint8Array(bodyBuffer);
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
  if (url.endsWith('/v1/vfs/crdt/push')) {
    const pushBytes = await readPushBodyBytes(input, init);
    if (pushBytes) {
      requests.push({
        url,
        body: decodeVfsCrdtPushRequestProtobuf(pushBytes)
      });
      return;
    }
  }

  if (typeof init?.body === 'string') {
    requests.push({ url, body: JSON.parse(init.body) });
  }
}
