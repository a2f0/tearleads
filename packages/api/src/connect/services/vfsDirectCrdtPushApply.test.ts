import { generateKeyPair, serializeKeyPair } from '@tearleads/shared';
import { describe, expect, it, vi } from 'vitest';
import { applyCrdtPushOperations } from './vfsDirectCrdtPushApply.js';
import {
  createAuthorizedItemRow,
  createItemOwnershipRow,
  createOperation,
  createParsedOperation,
  createQueryResult,
  signAclPushOperation
} from './vfsDirectCrdtPushApplyTestUtils.js';

describe('vfsDirectCrdtPushApply', () => {
  it('returns invalidOp for entries marked invalid without querying storage', async () => {
    const queryMock = vi.fn();

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [{ status: 'invalid', opId: 'bad-op' }]
    });

    expect(result.results).toEqual([{ opId: 'bad-op', status: 'invalidOp' }]);
    expect(result.notifications).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns invalidOp when operation item is not owned by the actor', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([createItemOwnershipRow({ ownerId: 'user-2' })])
      )
      .mockResolvedValueOnce(createQueryResult([]));

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [createParsedOperation(createOperation({}))]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'invalidOp' }]);
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[0]?.[0])).toContain('FROM vfs_registry');
  });

  it('returns invalidOp when operation item is not owned by the declared org', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([createItemOwnershipRow({ organizationId: 'org-2' })])
      )
      .mockResolvedValueOnce(createQueryResult([]));

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [createParsedOperation(createOperation({}))]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'invalidOp' }]);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('returns applied when actor has effective write visibility on non-owned item', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([createItemOwnershipRow({ ownerId: 'user-2' })])
      )
      .mockResolvedValueOnce(createQueryResult([createAuthorizedItemRow()]))
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(
        createQueryResult(
          [
            {
              id: 'change-1',
              occurred_at: '2026-02-16T00:00:02.000Z'
            }
          ],
          1
        )
      )
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult());

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [
        createParsedOperation(
          createOperation({
            opType: 'item_upsert',
            encryptedPayload: 'YWJj',
            keyEpoch: 1,
            encryptionNonce: 'bm9uY2U=',
            encryptionAad: 'YWFk',
            encryptionSignature: 'c2ln'
          })
        )
      ]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'applied' }]);
    expect(queryMock).toHaveBeenCalledTimes(9);
  });

  it('applies writer read grants for new principals and strips extra ACL fields', async () => {
    const keyPair = generateKeyPair();
    const serializedKeyPair = serializeKeyPair(keyPair);
    const signedOperation = createOperation({
      opType: 'acl_add',
      principalType: 'user',
      principalId: 'user-3',
      accessLevel: 'read',
      parentId: 'folder-1',
      childId: 'other-item',
      encryptedPayload: 'YWJj',
      keyEpoch: 7,
      encryptionNonce: 'bm9uY2U=',
      encryptionAad: 'YWFk',
      encryptionSignature: 'c2ln'
    });
    signedOperation.operationSignature = signAclPushOperation(
      signedOperation,
      keyPair.ed25519PrivateKey
    );
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([createItemOwnershipRow({ ownerId: 'user-2' })])
      )
      .mockResolvedValueOnce(createQueryResult([createAuthorizedItemRow()]))
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(
        createQueryResult([
          {
            public_signing_key: serializedKeyPair.ed25519PublicKey
          }
        ])
      )
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(
        createQueryResult(
          [
            {
              id: 'change-1',
              occurred_at: '2026-02-16T00:00:02.000Z'
            }
          ],
          1
        )
      )
      .mockResolvedValueOnce(createQueryResult([]));
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => {});
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    try {
      const result = await applyCrdtPushOperations({
        client: { query: queryMock },
        userId: 'user-1',
        organizationId: 'org-1',
        parsedOperations: [createParsedOperation(signedOperation)]
      });

      expect(result.results).toEqual([{ opId: 'op-1', status: 'applied' }]);
      expect(result.notifications).toEqual([
        {
          containerId: 'item-1',
          changedAt: '2026-02-16T00:00:02.000Z',
          changeId: 'change-1'
        }
      ]);

      const insertValues = queryMock.mock.calls[7]?.[1];
      expect(Array.isArray(insertValues)).toBe(true);
      if (!Array.isArray(insertValues)) {
        throw new Error('expected insert values');
      }

      expect(insertValues[2]).toBe('user');
      expect(insertValues[3]).toBe('user-3');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'ACL operation applied:',
        expect.objectContaining({
          action: 'acl_mutation',
          result: 'applied'
        })
      );
      expect(insertValues[4]).toBe('read');
      expect(insertValues[5]).toBeNull();
      expect(insertValues[6]).toBeNull();
      expect(insertValues[11]).toBeNull();
      expect(insertValues[12]).toBeNull();
      expect(insertValues[13]).toBeNull();
      expect(insertValues[14]).toBeNull();
      expect(insertValues[15]).toBeNull();
      expect(insertValues[16]).toBeNull();
      expect(insertValues[17]).toBeNull();
      expect(insertValues[18]).toBeNull();
      expect(insertValues[19]).toBeNull();
      expect(insertValues[20]).toBeNull();
      expect(insertValues[21]).toBeInstanceOf(Uint8Array);

      const auditEvent = JSON.parse(String(consoleInfoSpy.mock.calls[0]?.[0]));
      expect(auditEvent).toMatchObject({
        reason: null,
        status: 'applied',
        operation: {
          opId: 'op-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-16T00:00:00.000Z',
          principalType: 'user',
          principalId: 'user-3',
          accessLevel: 'read'
        }
      });
    } finally {
      consoleWarnSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    }
  });

  it('rejects ACL operations without an operationSignature', async () => {
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => {});

    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(createQueryResult([createItemOwnershipRow()]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([]));

    try {
      const result = await applyCrdtPushOperations({
        client: { query: queryMock },
        userId: 'user-1',
        organizationId: 'org-1',
        parsedOperations: [
          createParsedOperation(
            createOperation({
              opType: 'acl_add',
              principalType: 'user',
              principalId: 'user-3',
              accessLevel: 'read'
            })
          )
        ]
      });

      expect(result.results).toEqual([{ opId: 'op-1', status: 'invalidOp' }]);
      expect(queryMock).toHaveBeenCalledTimes(5);
      expect(
        JSON.parse(String(consoleInfoSpy.mock.calls[0]?.[0]))
      ).toMatchObject({
        reason: 'acl_signature_missing',
        status: 'invalidOp'
      });
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });

  it('returns staleWriteId when writeId does not advance replica head', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(createQueryResult([createItemOwnershipRow()]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(
        createQueryResult([
          {
            replica_id: 'desktop',
            max_write_id: 5,
            max_occurred_at: null
          }
        ])
      )
      .mockResolvedValueOnce(createQueryResult([]));

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [createParsedOperation(createOperation({ writeId: 5 }))]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'staleWriteId' }]);
    expect(queryMock).toHaveBeenCalledTimes(5);
  });

  it('returns alreadyApplied and advances replica head when needed', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(createQueryResult([createItemOwnershipRow()]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(
        createQueryResult([
          {
            replica_id: 'desktop',
            max_write_id: 1,
            max_occurred_at: '2026-02-16T00:00:00.000Z'
          }
        ])
      )
      .mockResolvedValueOnce(
        createQueryResult([
          {
            id: 'crdt-existing',
            occurred_at: '2026-02-16T00:00:01.000Z'
          }
        ])
      )
      .mockResolvedValueOnce(createQueryResult());

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [createParsedOperation(createOperation({ writeId: 3 }))]
    });

    expect(result.results).toEqual([
      { opId: 'op-1', status: 'alreadyApplied' }
    ]);
    expect(String(queryMock.mock.calls[5]?.[0])).toContain(
      'INSERT INTO vfs_crdt_replica_heads'
    );
  });

  it('keeps alreadyApplied without replica head upsert when writeId is not newer', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(createQueryResult([createItemOwnershipRow()]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(
        createQueryResult([
          {
            replica_id: 'desktop',
            max_write_id: 8,
            max_occurred_at: '2026-02-16T00:00:00.000Z'
          }
        ])
      )
      .mockResolvedValueOnce(
        createQueryResult([
          {
            id: 'crdt-existing',
            occurred_at: '2026-02-16T00:00:01.000Z'
          }
        ])
      );

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [createParsedOperation(createOperation({ writeId: 7 }))]
    });

    expect(result.results).toEqual([
      { opId: 'op-1', status: 'alreadyApplied' }
    ]);
    expect(queryMock).toHaveBeenCalledTimes(5);
  });

  it('returns applied, records notifications, and writes canonical item state', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(createQueryResult([createItemOwnershipRow()]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(
        createQueryResult(
          [
            {
              id: 'change-1',
              occurred_at: '2026-02-16T00:00:02.000Z'
            }
          ],
          1
        )
      )
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult());

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [
        createParsedOperation(
          createOperation({
            opType: 'item_upsert',
            encryptedPayload: 'YWJj',
            keyEpoch: 1,
            encryptionNonce: 'bm9uY2U=',
            encryptionAad: 'YWFk',
            encryptionSignature: 'c2ln'
          })
        )
      ]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'applied' }]);
    expect(result.notifications).toEqual([
      {
        containerId: 'item-1',
        changedAt: '2026-02-16T00:00:02.000Z',
        changeId: 'change-1'
      }
    ]);

    const insertValues = queryMock.mock.calls[5]?.[1];
    expect(Array.isArray(insertValues)).toBe(true);
    if (!Array.isArray(insertValues)) {
      throw new Error('expected insert values');
    }

    expect(insertValues[11]).toBeNull();
    expect(insertValues[16]).toBeNull();
    expect(insertValues[17]).toBeInstanceOf(Uint8Array);

    expect(String(queryMock.mock.calls[7]?.[0])).toContain('vfs_item_state');
    expect(String(queryMock.mock.calls[8]?.[0])).toContain(
      'vfs_emit_sync_change'
    );
  });

  it('returns outdatedOp when insert does not affect any rows', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(createQueryResult([createItemOwnershipRow()]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([], 0));

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [createParsedOperation(createOperation({}))]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'outdatedOp' }]);
    expect(result.notifications).toEqual([]);
    expect(queryMock).toHaveBeenCalledTimes(6);
  });
});
