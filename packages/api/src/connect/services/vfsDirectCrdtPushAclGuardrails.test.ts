import type { VfsCrdtPushOperation } from '@tearleads/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  isAclMutationAuthorized,
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
        createOperation({
          opType: 'acl_remove',
          accessLevel: 'read'
        })
      )
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

  it('rejects non-owner attempts to remove item owners', () => {
    const normalizedOperation = normalizeAclOperation(
      createOperation({
        opType: 'acl_remove',
        principalId: 'user-2',
        accessLevel: undefined
      })
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
