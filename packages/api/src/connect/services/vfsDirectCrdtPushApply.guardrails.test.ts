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
    principalType: 'user',
    principalId: 'user-3',
    accessLevel: 'admin',
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

describe('vfsDirectCrdtPushApply guardrails', () => {
  it('rejects writer admin grants when access ranks arrive as strings', async () => {
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => {});
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce(
        createQueryResult([createItemOwnershipRow({ ownerId: 'user-2' })])
      )
      .mockResolvedValueOnce(
        createQueryResult([{ item_id: 'item-1', access_rank: '2' }])
      )
      .mockResolvedValueOnce(createQueryResult())
      .mockResolvedValueOnce(createQueryResult([]))
      .mockResolvedValueOnce(createQueryResult([]));

    try {
      const result = await applyCrdtPushOperations({
        client: { query: queryMock },
        userId: 'user-1',
        organizationId: 'org-1',
        parsedOperations: [createParsedOperation(createOperation({}))]
      });

      expect(result.results).toEqual([{ opId: 'op-1', status: 'invalidOp' }]);
      expect(
        JSON.parse(String(consoleInfoSpy.mock.calls[0]?.[0]))
      ).toMatchObject({
        reason: 'acl_semantics_rejected',
        status: 'invalidOp'
      });
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });
});
