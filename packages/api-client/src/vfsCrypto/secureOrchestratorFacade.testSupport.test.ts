import { describe, expect, it } from 'vitest';
import { VFS_V2_CONNECT_BASE_PATH as VFS_CONNECT_BASE_PATH } from '@tearleads/shared';
import { recordSecureFacadeRequestBody } from './secureOrchestratorFacade.testSupport';

function createConnectPushBody(): string {
  return JSON.stringify({
    json: JSON.stringify({
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
    })
  });
}

describe('recordSecureFacadeRequestBody', () => {
  it('records connect push payloads from JSON string bodies', async () => {
    const url = `https://example.test${VFS_CONNECT_BASE_PATH}/PushCrdtOps`;
    const requests: Array<{ url: string; body: unknown }> = [];

    await recordSecureFacadeRequestBody(requests, url, url, {
      body: createConnectPushBody()
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual(
      expect.objectContaining({
        clientId: 'desktop',
        operations: [expect.objectContaining({ opId: 'desktop-1' })]
      })
    );
  });

  it('records connect push payloads from Request bodies', async () => {
    const url = `https://example.test${VFS_CONNECT_BASE_PATH}/PushCrdtOps`;
    const request = new Request(url, {
      method: 'POST',
      body: createConnectPushBody()
    });

    const requests: Array<{ url: string; body: unknown }> = [];
    await recordSecureFacadeRequestBody(requests, url, request, undefined);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual(
      expect.objectContaining({
        clientId: 'desktop',
        operations: [expect.objectContaining({ opId: 'desktop-1' })]
      })
    );
  });

  it('throws on malformed connect push JSON payloads and skips missing body', async () => {
    const url = `https://example.test${VFS_CONNECT_BASE_PATH}/PushCrdtOps`;
    const malformedRequest = new Request(url, {
      method: 'POST',
      body: '{'
    });

    const requests: Array<{ url: string; body: unknown }> = [];
    await expect(
      recordSecureFacadeRequestBody(requests, url, malformedRequest, undefined)
    ).rejects.toThrow();
    await recordSecureFacadeRequestBody(requests, url, url, undefined);

    expect(requests).toHaveLength(0);
  });

  it('records JSON string bodies for non-push routes and ignores non-string bodies', async () => {
    const url = `https://example.test${VFS_CONNECT_BASE_PATH}/StageBlob`;
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
