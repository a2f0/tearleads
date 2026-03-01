import { encodeVfsCrdtPushRequestProtobuf } from '@tearleads/vfs-sync/vfs';
import { describe, expect, it } from 'vitest';
import { recordSecureFacadeRequestBody } from './secureOrchestratorFacade.testSupport';

function createPushRequestBytes(): Uint8Array {
  const encoded = encodeVfsCrdtPushRequestProtobuf({
    clientId: 'desktop',
    operations: [
      {
        opId: 'desktop-1',
        opType: 'link_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-19T00:00:00.000Z',
        parentId: 'parent-1',
        childId: 'item-1'
      }
    ]
  });
  return new Uint8Array(encoded);
}

describe('recordSecureFacadeRequestBody', () => {
  it('records protobuf push payloads from Uint8Array and ArrayBuffer bodies', async () => {
    const url = 'https://example.test/v1/vfs/crdt/push';
    const bytes = createPushRequestBytes();
    const arrayBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(arrayBuffer).set(bytes);
    const requests: Array<{ url: string; body: unknown }> = [];

    await recordSecureFacadeRequestBody(requests, url, url, {
      body: bytes
    });
    await recordSecureFacadeRequestBody(requests, url, url, {
      body: arrayBuffer
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.body).toEqual(
      expect.objectContaining({
        clientId: 'desktop',
        operations: [expect.objectContaining({ opId: 'desktop-1' })]
      })
    );
    expect(requests[1]?.body).toEqual(requests[0]?.body);
  });

  it('records protobuf push payloads from ArrayBufferView and Blob bodies', async () => {
    const url = 'https://example.test/v1/vfs/crdt/push';
    const bytes = createPushRequestBytes();
    const viewSource = new Uint8Array(bytes.byteLength);
    viewSource.set(bytes);
    const requests: Array<{ url: string; body: unknown }> = [];

    await recordSecureFacadeRequestBody(requests, url, url, {
      body: new DataView(viewSource.buffer, 0, viewSource.byteLength)
    });
    await recordSecureFacadeRequestBody(requests, url, url, {
      body: new Blob([viewSource])
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.body).toEqual(requests[1]?.body);
  });

  it('throws on malformed Request push payloads and skips missing push body', async () => {
    const url = 'https://example.test/v1/vfs/crdt/push';
    const malformedRequest = new Request(url, {
      method: 'POST',
      body: new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    });

    const requests: Array<{ url: string; body: unknown }> = [];
    await expect(
      recordSecureFacadeRequestBody(requests, url, malformedRequest, undefined)
    ).rejects.toThrow();
    await recordSecureFacadeRequestBody(requests, url, url, undefined);

    expect(requests).toHaveLength(0);
  });

  it('skips empty Blob payloads and bodyless Request payloads for push routes', async () => {
    const url = 'https://example.test/v1/vfs/crdt/push';
    const requests: Array<{ url: string; body: unknown }> = [];

    await recordSecureFacadeRequestBody(requests, url, url, {
      body: new Blob([])
    });
    await recordSecureFacadeRequestBody(
      requests,
      url,
      new Request(url, { method: 'POST' }),
      undefined
    );

    expect(requests).toHaveLength(0);
  });

  it('records JSON string bodies for non-push routes and ignores non-string bodies', async () => {
    const url = 'https://example.test/v1/vfs/blobs/stage';
    const requests: Array<{ url: string; body: unknown }> = [];

    await recordSecureFacadeRequestBody(requests, url, url, {
      body: JSON.stringify({ ok: true, id: 'stage-1' })
    });
    await recordSecureFacadeRequestBody(requests, url, url, {
      body: new Blob(['ignored'])
    });

    expect(requests).toEqual([
      {
        url,
        body: { ok: true, id: 'stage-1' }
      }
    ]);
  });
});
