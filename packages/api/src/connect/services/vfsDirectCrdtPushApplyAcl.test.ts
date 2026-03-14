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
    opType: 'item_delete',
    itemId: 'item-1',
    replicaId: 'desktop',
    writeId: 1,
    occurredAt: '2026-02-16T00:00:00.000Z',
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

function createItemOwnershipRow(
  overrides: { ownerId?: string; organizationId?: string } = {}
): {
  id: string;
  owner_id: string;
  organization_id: string;
} {
  return {
    id: 'item-1',
    owner_id: overrides.ownerId ?? 'user-1',
    organization_id: overrides.organizationId ?? 'org-1'
  };
}

function createAuthorizedItemRow(
  itemId = 'item-1',
  accessRank = 2
): {
  item_id: string;
  access_rank: number;
} {
  return {
    item_id: itemId,
    access_rank: accessRank
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

describe('vfsDirectCrdtPushApply ACL semantic validation', () => {
  it('returns aclDenied when writer tries to grant admin access', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([createItemOwnershipRow({ ownerId: 'user-2' })])
      )
      .mockResolvedValueOnce(
        createQueryResult([createAuthorizedItemRow('item-1', 2)])
      )
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]));

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [
        createParsedOperation(
          createOperation({
            opType: 'acl_add',
            principalType: 'user',
            principalId: 'target-user',
            accessLevel: 'admin'
          })
        )
      ]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'aclDenied' }]);
    expect(consoleSpy).toHaveBeenCalledWith(
      'ACL operation denied:',
      expect.objectContaining({
        denialReason: 'only admins can grant admin access'
      })
    );
    consoleSpy.mockRestore();
  });

  it('returns aclDenied when user tries to self-elevate access', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([createItemOwnershipRow({ ownerId: 'user-2' })])
      )
      .mockResolvedValueOnce(
        createQueryResult([createAuthorizedItemRow('item-1', 2)])
      )
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]));

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [
        createParsedOperation(
          createOperation({
            opType: 'acl_add',
            principalType: 'user',
            principalId: 'user-1',
            accessLevel: 'admin'
          })
        )
      ]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'aclDenied' }]);
    consoleSpy.mockRestore();
  });

  it('returns aclDenied when writer tries to revoke access', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([createItemOwnershipRow({ ownerId: 'user-2' })])
      )
      .mockResolvedValueOnce(
        createQueryResult([createAuthorizedItemRow('item-1', 2)])
      )
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]));

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [
        createParsedOperation(
          createOperation({
            opType: 'acl_remove',
            principalType: 'user',
            principalId: 'target-user'
          })
        )
      ]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'aclDenied' }]);
    consoleSpy.mockRestore();
  });

  it('returns aclDenied when non-owner tries to remove owner access', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([createItemOwnershipRow({ ownerId: 'user-2' })])
      )
      .mockResolvedValueOnce(
        createQueryResult([createAuthorizedItemRow('item-1', 3)])
      )
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]));

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [
        createParsedOperation(
          createOperation({
            opType: 'acl_remove',
            principalType: 'user',
            principalId: 'user-2'
          })
        )
      ]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'aclDenied' }]);
    consoleSpy.mockRestore();
  });

  it('allows owner to grant admin access via acl_add', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(createQueryResult([createItemOwnershipRow()]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(
        createQueryResult(
          [{ id: 'change-1', occurred_at: '2026-02-16T00:00:02.000Z' }],
          1
        )
      )
      .mockResolvedValueOnce(createQueryResult());

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [
        createParsedOperation(
          createOperation({
            opType: 'acl_add',
            principalType: 'user',
            principalId: 'target-user',
            accessLevel: 'admin'
          })
        )
      ]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'applied' }]);
    expect(consoleSpy).toHaveBeenCalledWith(
      'ACL operation applied:',
      expect.objectContaining({ result: 'applied' })
    );
    consoleSpy.mockRestore();
  });

  it('allows writer to grant read access via acl_add', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([createItemOwnershipRow({ ownerId: 'user-2' })])
      )
      .mockResolvedValueOnce(
        createQueryResult([createAuthorizedItemRow('item-1', 2)])
      )
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(
        createQueryResult(
          [{ id: 'change-1', occurred_at: '2026-02-16T00:00:02.000Z' }],
          1
        )
      )
      .mockResolvedValueOnce(createQueryResult());

    const result = await applyCrdtPushOperations({
      client: { query: queryMock },
      userId: 'user-1',
      organizationId: 'org-1',
      parsedOperations: [
        createParsedOperation(
          createOperation({
            opType: 'acl_add',
            principalType: 'user',
            principalId: 'target-user',
            accessLevel: 'read'
          })
        )
      ]
    });

    expect(result.results).toEqual([{ opId: 'op-1', status: 'applied' }]);
    consoleSpy.mockRestore();
  });
});
