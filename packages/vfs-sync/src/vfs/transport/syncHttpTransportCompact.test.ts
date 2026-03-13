import { describe, expect, it, vi } from 'vitest';
import { VfsHttpCrdtSyncTransport } from './sync-http-transport.js';

function connectJsonEnvelope(payload: unknown): string {
  return JSON.stringify({ json: JSON.stringify(payload) });
}

describe('VfsHttpCrdtSyncTransport compact encoding guardrails', () => {
  it('rejects push operations with invalid occurredAt values', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        connectJsonEnvelope({
          clientId: 'desktop',
          results: []
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    });

    const transport = new VfsHttpCrdtSyncTransport({
      baseUrl: 'https://sync.example.com',
      fetchImpl: fetchMock,
      organizationId: 'org-1'
    });

    await expect(
      transport.pushOperations({
        userId: 'user-1',
        clientId: 'desktop',
        operations: [
          {
            opId: 'desktop-1',
            opType: 'acl_add',
            itemId: 'item-1',
            replicaId: 'desktop',
            writeId: 1,
            occurredAt: 'not-a-date',
            principalType: 'group',
            principalId: 'group-1',
            accessLevel: 'read'
          }
        ]
      })
    ).rejects.toThrow('operation occurredAt must be a valid ISO timestamp');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
