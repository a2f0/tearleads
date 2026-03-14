import type { VfsCrdtPushOperation } from '@tearleads/shared';
import { describe, expect, it } from 'vitest';
import {
  type AclValidationContext,
  buildAclAuditEntry,
  validateAclOperationSemantics
} from './vfsDirectCrdtPushAclValidation.js';

type AclOperationOverrides = Omit<
  Partial<VfsCrdtPushOperation>,
  'accessLevel' | 'principalType' | 'principalId' | 'encryptedPayload'
> & {
  accessLevel?: VfsCrdtPushOperation['accessLevel'] | null;
  principalType?: VfsCrdtPushOperation['principalType'] | null;
  principalId?: VfsCrdtPushOperation['principalId'] | null;
  encryptedPayload?: VfsCrdtPushOperation['encryptedPayload'] | null;
};

function createAclOperation(
  overrides: AclOperationOverrides = {}
): VfsCrdtPushOperation {
  const { accessLevel, principalType, principalId, encryptedPayload, ...rest } =
    overrides;
  const base: VfsCrdtPushOperation = {
    opId: 'op-1',
    opType: 'acl_add',
    itemId: 'item-1',
    replicaId: 'desktop',
    writeId: 1,
    occurredAt: '2026-02-16T00:00:00.000Z',
    principalType: 'user',
    principalId: 'target-user',
    accessLevel: 'read',
    ...rest
  };
  if (accessLevel !== undefined) {
    if (accessLevel === null) {
      delete base.accessLevel;
    } else {
      base.accessLevel = accessLevel;
    }
  }
  if (principalType !== undefined) {
    if (principalType === null) {
      delete base.principalType;
    } else {
      base.principalType = principalType;
    }
  }
  if (principalId !== undefined) {
    if (principalId === null) {
      delete base.principalId;
    } else {
      base.principalId = principalId;
    }
  }
  if (encryptedPayload !== undefined) {
    if (encryptedPayload === null) {
      delete base.encryptedPayload;
    } else {
      base.encryptedPayload = encryptedPayload;
    }
  }
  return base;
}

function createContext(
  overrides: Partial<AclValidationContext> = {}
): AclValidationContext {
  return {
    actorId: 'actor-1',
    actorAccessRank: 3,
    isItemOwner: true,
    itemOwnerId: 'actor-1',
    ...overrides
  };
}

describe('validateAclOperationSemantics', () => {
  describe('non-ACL operations', () => {
    it('passes through non-ACL operations', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ opType: 'item_upsert' }),
        createContext()
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('encrypted ACL operations', () => {
    it('skips validation for encrypted operations', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          encryptedPayload: 'encrypted-data',
          principalType: null,
          principalId: null,
          accessLevel: null
        }),
        createContext({ actorAccessRank: 1 })
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('field integrity', () => {
    it('rejects acl_remove with accessLevel', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ opType: 'acl_remove', accessLevel: 'read' }),
        createContext()
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('acl_remove must not carry an accessLevel');
    });

    it('rejects acl_add without accessLevel', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ accessLevel: null }),
        createContext()
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('acl_add requires an accessLevel');
    });

    it('rejects ACL operation without principalType', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ principalType: null }),
        createContext()
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(
        'ACL operation requires principalType and principalId'
      );
    });

    it('rejects ACL operation without principalId', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ principalId: null }),
        createContext()
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(
        'ACL operation requires principalType and principalId'
      );
    });
  });

  describe('self-elevation prevention', () => {
    it('rejects self-elevation from write to admin', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          principalId: 'actor-1',
          accessLevel: 'admin'
        }),
        createContext({ actorAccessRank: 2, isItemOwner: false })
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('cannot elevate own access level');
    });

    it('rejects self-elevation from read to write', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          principalId: 'actor-1',
          accessLevel: 'write'
        }),
        createContext({
          actorAccessRank: 1,
          isItemOwner: false,
          itemOwnerId: 'other-user'
        })
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('cannot elevate own access level');
    });

    it('allows admin granting themselves admin (same level)', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          principalId: 'actor-1',
          accessLevel: 'admin'
        }),
        createContext({ actorAccessRank: 3 })
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('owner protection', () => {
    it('rejects non-owner removing item owner access', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          opType: 'acl_remove',
          principalId: 'owner-1',
          accessLevel: null
        }),
        createContext({
          actorId: 'admin-1',
          actorAccessRank: 3,
          isItemOwner: false,
          itemOwnerId: 'owner-1'
        })
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('cannot remove item owner access');
    });

    it('allows owner removing their own access', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          opType: 'acl_remove',
          principalId: 'owner-1',
          accessLevel: null
        }),
        createContext({
          actorId: 'owner-1',
          actorAccessRank: 3,
          isItemOwner: true,
          itemOwnerId: 'owner-1'
        })
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('admin-only operations', () => {
    it('rejects writer granting admin access', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ accessLevel: 'admin' }),
        createContext({
          actorAccessRank: 2,
          isItemOwner: false,
          itemOwnerId: 'other'
        })
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('only admins can grant admin access');
    });

    it('allows admin granting admin access', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ accessLevel: 'admin' }),
        createContext({ actorAccessRank: 3 })
      );
      expect(result.valid).toBe(true);
    });

    it('rejects writer revoking access', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          opType: 'acl_remove',
          principalId: 'other-user',
          accessLevel: null
        }),
        createContext({
          actorAccessRank: 2,
          isItemOwner: false,
          itemOwnerId: 'some-owner'
        })
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('only admins can revoke access');
    });

    it('allows admin revoking access', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          opType: 'acl_remove',
          principalId: 'other-user',
          accessLevel: null
        }),
        createContext({ actorAccessRank: 3 })
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('writer access level restrictions', () => {
    it('allows writer granting read access', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ accessLevel: 'read' }),
        createContext({
          actorAccessRank: 2,
          isItemOwner: false,
          itemOwnerId: 'other'
        })
      );
      expect(result.valid).toBe(true);
    });

    it('rejects writer granting write access', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ accessLevel: 'write' }),
        createContext({
          actorAccessRank: 2,
          isItemOwner: false,
          itemOwnerId: 'other'
        })
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('writers can only grant read access');
    });
  });

  describe('read-only user restrictions', () => {
    it('rejects read-only user issuing acl_add', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ accessLevel: 'read' }),
        createContext({
          actorAccessRank: 1,
          isItemOwner: false,
          itemOwnerId: 'other'
        })
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(
        'insufficient access level for ACL operations'
      );
    });

    it('rejects read-only user issuing acl_remove', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          opType: 'acl_remove',
          accessLevel: null
        }),
        createContext({
          actorAccessRank: 1,
          isItemOwner: false,
          itemOwnerId: 'other'
        })
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('valid operations', () => {
    it('allows admin acl_add with write access', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ accessLevel: 'write' }),
        createContext({ actorAccessRank: 3 })
      );
      expect(result.valid).toBe(true);
    });

    it('allows owner acl_add with admin access', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({ accessLevel: 'admin' }),
        createContext({ isItemOwner: true, actorAccessRank: 3 })
      );
      expect(result.valid).toBe(true);
    });

    it('allows admin acl_remove for non-owner principal', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          opType: 'acl_remove',
          principalId: 'other-user',
          accessLevel: null
        }),
        createContext({ actorAccessRank: 3, itemOwnerId: 'owner-1' })
      );
      expect(result.valid).toBe(true);
    });

    it('allows acl_add for group principal', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }),
        createContext({ actorAccessRank: 2, isItemOwner: false })
      );
      expect(result.valid).toBe(true);
    });

    it('allows acl_add for organization principal', () => {
      const result = validateAclOperationSemantics(
        createAclOperation({
          principalType: 'organization',
          principalId: 'org-1',
          accessLevel: 'read'
        }),
        createContext({ actorAccessRank: 2, isItemOwner: false })
      );
      expect(result.valid).toBe(true);
    });
  });
});

describe('buildAclAuditEntry', () => {
  it('builds audit entry for denied operation', () => {
    const entry = buildAclAuditEntry(
      createAclOperation(),
      'actor-1',
      'denied',
      'test reason'
    );
    expect(entry).toEqual({
      action: 'acl_mutation',
      opType: 'acl_add',
      opId: 'op-1',
      itemId: 'item-1',
      actorId: 'actor-1',
      principalType: 'user',
      principalId: 'target-user',
      accessLevel: 'read',
      occurredAt: '2026-02-16T00:00:00.000Z',
      result: 'denied',
      denialReason: 'test reason'
    });
  });

  it('builds audit entry for applied operation', () => {
    const entry = buildAclAuditEntry(
      createAclOperation(),
      'actor-1',
      'applied'
    );
    expect(entry.result).toBe('applied');
    expect(entry.denialReason).toBeUndefined();
  });
});
