import { signAclOperation, type VfsCrdtPushOperation } from '@tearleads/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import type { ParsedPushOperation } from './vfsDirectCrdtPushParse.js';

export function createOperation(
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

export function createParsedOperation(
  operation: VfsCrdtPushOperation
): ParsedPushOperation {
  return {
    status: 'parsed',
    opId: operation.opId,
    operation
  };
}

export function signAclPushOperation(
  operation: VfsCrdtPushOperation,
  ed25519PrivateKey: Uint8Array
): string {
  if (
    (operation.opType !== 'acl_add' && operation.opType !== 'acl_remove') ||
    !operation.principalType ||
    !operation.principalId
  ) {
    throw new Error('operation must be a signed ACL mutation');
  }

  return signAclOperation(
    {
      opId: operation.opId,
      opType: operation.opType,
      itemId: operation.itemId,
      replicaId: operation.replicaId,
      writeId: operation.writeId,
      occurredAt: operation.occurredAt,
      principalType: operation.principalType,
      principalId: operation.principalId,
      accessLevel:
        operation.opType === 'acl_add' ? (operation.accessLevel ?? '') : ''
    },
    ed25519PrivateKey
  );
}

export function createItemOwnershipRow(
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

export function createAuthorizedItemRow(
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

export function createQueryResult<T extends QueryResultRow>(
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
