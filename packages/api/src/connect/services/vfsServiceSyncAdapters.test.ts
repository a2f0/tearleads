import { create, toJsonString } from '@bufbuild/protobuf';
import { VfsGetCrdtSyncResponseSchema } from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import { describe, expect, it } from 'vitest';
import { toProtoCrdtSyncResponse } from './vfsServiceSyncAdapters.js';

describe('toProtoCrdtSyncResponse', () => {
  it('produces connect-json-serializable byte identifiers', () => {
    const response = toProtoCrdtSyncResponse({
      items: [
        {
          opId: '11111111-1111-1111-1111-111111111111',
          itemId: '22222222-2222-2222-2222-222222222222',
          opType: 'acl_add',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'share-1',
          occurredAtMs: 1_739_577_600_000,
          principalType: 'user',
          principalId: '33333333-3333-3333-3333-333333333333',
          accessLevel: 'read'
        }
      ],
      hasMore: false,
      lastReconciledWriteIds: {}
    });

    const firstItem = response.items[0];
    expect(firstItem?.sourceId).toBeInstanceOf(Uint8Array);
    expect(firstItem?.opId).toBeInstanceOf(Uint8Array);
    expect(firstItem?.itemId).toBeInstanceOf(Uint8Array);

    const message = create(VfsGetCrdtSyncResponseSchema, response);
    expect(() =>
      toJsonString(VfsGetCrdtSyncResponseSchema, message)
    ).not.toThrow();
  });
});
