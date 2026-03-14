import type { VfsCrdtPushOperation } from '@tearleads/shared';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  isAclOperation,
  isAclMutationAuthorized,
  loadAclTargetState,
  logAclMutationAudit,
  normalizeAclOperation
} from './vfsDirectCrdtPushAclGuardrails.js';

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
    principalId: 'user-2',
    accessLevel: 'read',
    ...overrides
  };
}

function createRemoveOperation(
  overrides: Omit<Partial<VfsCrdtPushOperation>, 'opType'> & {
    accessLevel?: VfsCrdtPushOperation['accessLevel'] | undefined;
  }
): VfsCrdtPushOperation {
  return {
    opId: 'op-1',
    opType: 'acl_remove',
    itemId: 'item-1',
    replicaId: 'desktop',
    writeId: 1,
    occurredAt: '2026-02-16T00:00:00.000Z',
    principalType: 'user',
    principalId: 'user-2',
    ...overrides
  };
}

function createAddOperationWithoutAccessLevel(): VfsCrdtPushOperation {
  return {
    opId: 'op-1',
    opType: 'acl_add',
    itemId: 'item-1',
    replicaId: 'desktop',
    writeId: 1,
    occurredAt: '2026-02-16T00:00:00.000Z',
    principalType: 'user',
    principalId: 'user-2'
  };
}

function createEmptyQueryResult<T extends QueryResultRow>(): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: 0,
    oid: 0,
    rows: [],
    fields: []
  };
}

describe('vfsDirectCrdtPushAclGuardrails', () => {
  it('strips unexpected fields from normalized ACL add operations', () => {
    expect(
      normalizeAclOperation(
        createOperation({
          parentId: 'folder-1',
          childId: 'other-item',
          encryptedPayload: 'YWJj',
          keyEpoch: 7,
          encryptionNonce: 'bm9uY2U=',
          encryptionAad: 'YWFk',
          encryptionSignature: 'c2ln'
        })
      )
    ).toEqual({
      opId: 'op-1',
      opType: 'acl_add',
      itemId: 'item-1',
      replicaId: 'desktop',
      writeId: 1,
      occurredAt: '2026-02-16T00:00:00.000Z',
      principalType: 'user',
      principalId: 'user-2',
      accessLevel: 'read'
    });
  });

  it('rejects ACL remove operations that include accessLevel', () => {
    expect(
      normalizeAclOperation(
        createRemoveOperation({
          accessLevel: 'read'
        })
      )
    ).toBeNull();
  });

  it('rejects non-ACL operations and malformed ACL base fields', () => {
    expect(isAclOperation(createOperation({ opType: 'acl_add' }))).toBe(true);
    expect(isAclOperation(createRemoveOperation({}))).toBe(true);
    expect(isAclOperation(createOperation({ opType: 'item_delete' }))).toBe(
      false
    );
    expect(
      normalizeAclOperation(createOperation({ opType: 'item_delete' }))
    ).toBe(null);
    expect(
      normalizeAclOperation(createOperation({ itemId: '   ' }))
    ).toBeNull();
    expect(
      normalizeAclOperation(createAddOperationWithoutAccessLevel())
    ).toBeNull();
  });

  it('rejects writer attempts to grant admin access', () => {
    const normalizedOperation = normalizeAclOperation(
      createOperation({
        principalId: 'user-3',
        accessLevel: 'admin'
      })
    );

    expect(normalizedOperation).not.toBeNull();
    if (!normalizedOperation) {
      throw new Error('Expected ACL operation to normalize');
    }

    expect(
      isAclMutationAuthorized({
        actorAccessRank: 2,
        actorId: 'user-1',
        itemOwnerId: 'user-9',
        operation: normalizedOperation,
        targetState: {
          accessLevel: null,
          isItemOwner: false
        }
      })
    ).toBe(false);
  });

  it('rejects ACL add mutations that downgrade owners or grant write access', () => {
    const ownerDowngradeOperation = normalizeAclOperation(
      createOperation({
        principalId: 'user-2',
        accessLevel: 'read'
      })
    );
    const writerGrantOperation = normalizeAclOperation(
      createOperation({
        principalId: 'user-3',
        accessLevel: 'write'
      })
    );

    expect(ownerDowngradeOperation).not.toBeNull();
    expect(writerGrantOperation).not.toBeNull();
    if (!ownerDowngradeOperation || !writerGrantOperation) {
      throw new Error('Expected ACL operations to normalize');
    }

    expect(
      isAclMutationAuthorized({
        actorAccessRank: 3,
        actorId: 'user-1',
        itemOwnerId: 'user-2',
        operation: ownerDowngradeOperation,
        targetState: {
          accessLevel: 'admin',
          isItemOwner: true
        }
      })
    ).toBe(false);
    expect(
      isAclMutationAuthorized({
        actorAccessRank: 2,
        actorId: 'user-1',
        itemOwnerId: 'user-9',
        operation: writerGrantOperation,
        targetState: {
          accessLevel: null,
          isItemOwner: false
        }
      })
    ).toBe(false);
  });

  it('rejects non-owner attempts to remove item owners', () => {
    const normalizedOperation = normalizeAclOperation(
      createRemoveOperation({ principalId: 'user-2' })
    );

    expect(normalizedOperation).not.toBeNull();
    if (!normalizedOperation) {
      throw new Error('Expected ACL operation to normalize');
    }

    expect(
      isAclMutationAuthorized({
        actorAccessRank: 3,
        actorId: 'user-1',
        itemOwnerId: 'user-2',
        operation: normalizedOperation,
        targetState: {
          accessLevel: 'admin',
          isItemOwner: true
        }
      })
    ).toBe(false);
  });

  it('loads item owners without querying and looks up stored ACL state', async () => {
    const ownerRunQuery = vi.fn();

    await expect(
      loadAclTargetState(ownerRunQuery, {
        itemId: 'item-1',
        itemOwnerId: 'user-2',
        principalType: 'user',
        principalId: 'user-2'
      })
    ).resolves.toEqual({
      accessLevel: 'admin',
      isItemOwner: true
    });
    expect(ownerRunQuery).not.toHaveBeenCalled();

    const labels: string[] = [];
    const storedRunQuery = async <T extends QueryResultRow>(
      label: string,
      _text: string,
      _values?: unknown[]
    ) => {
      labels.push(label);
      return createEmptyQueryResult<T>();
    };

    await expect(
      loadAclTargetState(storedRunQuery, {
        itemId: 'item-1',
        itemOwnerId: 'user-9',
        principalType: 'group',
        principalId: 'group-1'
      })
    ).resolves.toEqual({
      accessLevel: null,
      isItemOwner: false
    });
    expect(labels).toEqual(['acl_target_access_lookup']);
  });

  it('rejects writers managing existing principals but allows safe mutations', () => {
    const existingPrincipalOperation = normalizeAclOperation(
      createOperation({ principalId: 'user-3', accessLevel: 'read' })
    );
    const removeWriterOperation = normalizeAclOperation(
      createRemoveOperation({ principalId: 'user-4' })
    );
    const adminRemoveOperation = normalizeAclOperation(
      createRemoveOperation({ principalId: 'user-5' })
    );

    expect(existingPrincipalOperation).not.toBeNull();
    expect(removeWriterOperation).not.toBeNull();
    expect(adminRemoveOperation).not.toBeNull();
    if (
      !existingPrincipalOperation ||
      !removeWriterOperation ||
      !adminRemoveOperation
    ) {
      throw new Error('Expected ACL operations to normalize');
    }

    expect(
      isAclMutationAuthorized({
        actorAccessRank: 2,
        actorId: 'user-1',
        itemOwnerId: 'user-9',
        operation: existingPrincipalOperation,
        targetState: {
          accessLevel: 'read',
          isItemOwner: false
        }
      })
    ).toBe(false);
    expect(
      isAclMutationAuthorized({
        actorAccessRank: 2,
        actorId: 'user-1',
        itemOwnerId: 'user-9',
        operation: removeWriterOperation,
        targetState: {
          accessLevel: 'write',
          isItemOwner: false
        }
      })
    ).toBe(false);
    expect(
      isAclMutationAuthorized({
        actorAccessRank: 3,
        actorId: 'user-1',
        itemOwnerId: 'user-9',
        operation: adminRemoveOperation,
        targetState: {
          accessLevel: 'admin',
          isItemOwner: false
        }
      })
    ).toBe(true);
  });

  it('rejects writers removing admin principals they do not own', () => {
    const adminRemoveOperation = normalizeAclOperation(
      createRemoveOperation({ principalId: 'user-5' })
    );

    expect(adminRemoveOperation).not.toBeNull();
    if (!adminRemoveOperation) {
      throw new Error('Expected ACL operation to normalize');
    }

    expect(
      isAclMutationAuthorized({
        actorAccessRank: 2,
        actorId: 'user-1',
        itemOwnerId: 'user-9',
        operation: adminRemoveOperation,
        targetState: {
          accessLevel: 'admin',
          isItemOwner: false
        }
      })
    ).toBe(false);
  });

  it('emits ACL mutation audit logs as structured JSON', () => {
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => {});

    try {
      logAclMutationAudit({
        actorId: 'user-1',
        organizationId: 'org-1',
        operation: createOperation({ principalId: 'user-3' }),
        reason: 'acl_semantics_rejected',
        status: 'invalidOp'
      });

      const auditEvent = JSON.parse(String(consoleInfoSpy.mock.calls[0]?.[0]));
      expect(auditEvent).toMatchObject({
        event: 'vfs_acl_mutation_audit',
        actorId: 'user-1',
        organizationId: 'org-1',
        reason: 'acl_semantics_rejected',
        status: 'invalidOp',
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
      consoleInfoSpy.mockRestore();
    }
  });
});
