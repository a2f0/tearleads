import { create, toJsonString } from '@bufbuild/protobuf';
import {
  VfsCrdtOpType,
  VfsCrdtPushOperationSchema,
  VfsGetCrdtSyncResponseSchema,
  VfsGetSyncRequestSchema,
  VfsPushCrdtOpsRequestSchema,
  VfsPushCrdtOpsResponseSchema
} from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import { describe, expect, it } from 'vitest';
import {
  toDirectGetSyncRequest,
  toDirectPushRequest,
  toProtoCrdtSyncResponse,
  toProtoPushResponse
} from './vfsServiceSyncAdapters.js';

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
      lastReconciledWriteIds: {
        desktop: 7
      }
    });

    const firstItem = response.items[0];
    expect(firstItem?.sourceId).toBeInstanceOf(Uint8Array);
    expect(firstItem?.opId).toBeInstanceOf(Uint8Array);
    expect(firstItem?.itemId).toBeInstanceOf(Uint8Array);

    const message = create(VfsGetCrdtSyncResponseSchema, response);
    expect(toJsonString(VfsGetCrdtSyncResponseSchema, message)).toContain(
      '"lastReconciledWriteIds":{"desktop":7}'
    );
  });
});

describe('vfsServiceSyncAdapters', () => {
  it('rejects inbound push operations with unspecified op types', () => {
    const request = create(VfsPushCrdtOpsRequestSchema, {
      organizationId: new Uint8Array([1]),
      clientId: new Uint8Array([2]),
      operations: [
        {
          opId: new Uint8Array([3]),
          opType: VfsCrdtOpType.UNSPECIFIED,
          itemId: new Uint8Array([4]),
          replicaId: new Uint8Array([5]),
          writeId: 1n,
          occurredAtMs: 1n
        }
      ]
    });

    expect(() => toDirectPushRequest(request)).toThrow(/opType is invalid/);
  });

  it('rejects inbound push operations with missing required identifiers', () => {
    const request = create(VfsPushCrdtOpsRequestSchema, {
      organizationId: new Uint8Array([1]),
      clientId: new Uint8Array([2]),
      operations: [
        {
          opId: new Uint8Array(),
          opType: VfsCrdtOpType.ACL_ADD,
          itemId: new Uint8Array([4]),
          replicaId: new Uint8Array([5]),
          writeId: 1n,
          occurredAtMs: 1n
        }
      ]
    });

    expect(() => toDirectPushRequest(request)).toThrow(/opId is required/);
  });

  it('converts protobuf operation signatures into base64 strings', () => {
    const operation = create(VfsCrdtPushOperationSchema, {
      opId: new TextEncoder().encode('op-1'),
      opType: VfsCrdtOpType.ACL_ADD,
      itemId: new TextEncoder().encode('item-1'),
      replicaId: new TextEncoder().encode('desktop'),
      writeId: 1n,
      occurredAtMs: BigInt(Date.parse('2026-02-16T00:00:00.000Z')),
      principalType: 1,
      principalId: new TextEncoder().encode('user-2'),
      accessLevel: 1,
      operationSignature: new Uint8Array([1, 2, 3, 4])
    });
    const request = {
      organizationId: new Uint8Array(new Array(16).fill(1)),
      clientId: new TextEncoder().encode('desktop'),
      operations: [operation]
    } satisfies Parameters<typeof toDirectPushRequest>[0];

    const directRequest = toDirectPushRequest(request);
    const firstOperation = directRequest.operations[0];

    expect(firstOperation).toMatchObject({
      opId: 'op-1',
      itemId: 'item-1',
      replicaId: 'desktop',
      operationSignature: 'AQIDBA=='
    });
  });

  it('encodes push statuses with canonical proto enum names', () => {
    const response = toProtoPushResponse({
      clientId: 'desktop',
      results: [
        {
          opId: 'desktop-1',
          status: 'aclDenied'
        }
      ]
    });

    const message = create(VfsPushCrdtOpsResponseSchema, response);
    expect(toJsonString(VfsPushCrdtOpsResponseSchema, message)).toContain(
      'VFS_CRDT_PUSH_STATUS_ACL_DENIED'
    );
  });

  it('allows omitted rootId on sync requests', () => {
    const request = create(VfsGetSyncRequestSchema, {
      cursor: '',
      limit: 500
    });

    expect(toDirectGetSyncRequest(request)).toEqual({
      cursor: '',
      limit: 500,
      rootId: ''
    });
  });
  it('rejects malformed sync identifier bytes', () => {
    expect(() =>
      toDirectGetSyncRequest({
        cursor: '',
        limit: 500,
        rootId: new Uint8Array([0xc3, 0x28])
      })
    ).toThrow(/Invalid identifier encoding/);
  });

  it('falls back to empty string when organizationId is omitted', () => {
    const request = create(VfsPushCrdtOpsRequestSchema, {
      clientId: new TextEncoder().encode('desktop'),
      operations: []
    });

    const result = toDirectPushRequest(request);
    expect(result.organizationId).toBe('');
  });
});
