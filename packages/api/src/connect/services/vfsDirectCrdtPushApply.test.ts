import type { VfsCrdtPushOperation } from '@tearleads/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { applyCrdtPushOperations } from './vfsDirectCrdtPushApply.js';
import type { ParsedPushOperation } from './vfsDirectCrdtPushParse.js';

function createOperation(
  overrides: Partial<VfsCrdtPushOperation>
): VfsCrdtPushOperation {
  return {
    opId: 'op-1',
    opType: 'acl_add',
    itemId: 'item-1',
    replicaId: 'desktop',
    writeId: 1,
    occurredAt: '2026-02-16T00:00:00.000Z',
    principalType: 'group',
    principalId: 'group-1',
    accessLevel: 'read',
    ...overrides
  };
}

function createParsedOperation(
  operation: VfsCrdtPushOperation
): ParsedPushOperation {
  return {
    status: 'parsed',
    opId: operation.opId,
    operation
  };
}

function createQueryResult<T extends QueryResultRow>(
  rows: T[] = [],
  rowCount?: number
): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rowCount ?? rows.length,
    oid: 0,
    rows,
    fields: []
  };
}

describe('vfsDirectCrdtPushApply', () => {
  it('returns invalidOp for entries marked invalid without querying storage', async () => {
    const queryMock = vi.fn();

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
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
        createQueryResult([{ id: 'item-1', owner_id: 'user-2' }])
      );

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      parsedOperations: [createParsedOperation(createOperation({}))]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'invalidOp' }]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(String(queryMock.mock.calls[0]?.[0])).toContain('FROM vfs_registry');
  });

  it('returns staleWriteId when writeId does not advance replica head', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([{ id: 'item-1', owner_id: 'user-1' }])
      )
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
      parsedOperations: [createParsedOperation(createOperation({ writeId: 5 }))]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'staleWriteId' }]);
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it('returns alreadyApplied and advances replica head when needed', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([{ id: 'item-1', owner_id: 'user-1' }])
      )
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
      parsedOperations: [createParsedOperation(createOperation({ writeId: 3 }))]
    });

    expect(result.results).toEqual([
      { opId: 'op-1', status: 'alreadyApplied' }
    ]);
    expect(String(queryMock.mock.calls[4]?.[0])).toContain(
      'INSERT INTO vfs_crdt_replica_heads'
    );
  });

  it('keeps alreadyApplied without replica head upsert when writeId is not newer', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([{ id: 'item-1', owner_id: 'user-1' }])
      )
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
      parsedOperations: [createParsedOperation(createOperation({ writeId: 7 }))]
    });

    expect(result.results).toEqual([
      { opId: 'op-1', status: 'alreadyApplied' }
    ]);
    expect(queryMock).toHaveBeenCalledTimes(4);
  });

  it('returns applied, records notifications, and writes canonical item state', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([{ id: 'item-1', owner_id: 'user-1' }])
      )
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

    const insertValues = queryMock.mock.calls[4]?.[1];
    expect(Array.isArray(insertValues)).toBe(true);
    if (!Array.isArray(insertValues)) {
      throw new Error('expected insert values');
    }

    expect(insertValues[11]).toBeNull();
    expect(insertValues[16]).toBeInstanceOf(Buffer);

    expect(String(queryMock.mock.calls[6]?.[0])).toContain('vfs_item_state');
    expect(String(queryMock.mock.calls[7]?.[0])).toContain(
      'vfs_emit_sync_change'
    );
  });

  it('returns outdatedOp when insert does not affect any rows', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([{ id: 'item-1', owner_id: 'user-1' }])
      )
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([], 0));

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      parsedOperations: [createParsedOperation(createOperation({}))]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'outdatedOp' }]);
    expect(result.notifications).toEqual([]);
    expect(queryMock).toHaveBeenCalledTimes(5);
  });
});
