import { describe, expect, it } from 'vitest';
import {
  compileSharePolicyCore,
  type LinkEdge,
  type RegistryItemType,
  type SharePolicyDefinition,
  type SharePolicyPrincipalDefinition,
  type SharePolicySelectorDefinition
} from './vfsSharePolicyCompilerCore.js';

const NOW = new Date('2026-02-28T16:00:00.000Z');

function activePolicy(id: string, rootItemId: string): SharePolicyDefinition {
  return {
    id,
    rootItemId,
    status: 'active',
    revokedAt: null,
    expiresAt: null
  };
}

describe('compileSharePolicyCore', () => {
  it('applies deny-wins over include selectors for the same principal/item', () => {
    const policies = [activePolicy('policy-a', 'root-1')];
    const selectors: SharePolicySelectorDefinition[] = [
      {
        id: 'sel-include',
        policyId: 'policy-a',
        selectorKind: 'include',
        matchMode: 'subtree',
        anchorItemId: null,
        maxDepth: null,
        includeRoot: false,
        objectTypes: null,
        selectorOrder: 10
      },
      {
        id: 'sel-exclude-wallet',
        policyId: 'policy-a',
        selectorKind: 'exclude',
        matchMode: 'exact',
        anchorItemId: 'wallet-1',
        maxDepth: null,
        includeRoot: true,
        objectTypes: null,
        selectorOrder: 20
      }
    ];
    const principals: SharePolicyPrincipalDefinition[] = [
      {
        id: 'principal-a',
        policyId: 'policy-a',
        principalType: 'user',
        principalId: 'alice',
        accessLevel: 'read'
      }
    ];
    const registryItems: RegistryItemType[] = [
      { id: 'root-1', objectType: 'contact' },
      { id: 'wallet-1', objectType: 'walletItem' },
      { id: 'workout-1', objectType: 'healthWorkoutEntry' }
    ];
    const links: LinkEdge[] = [
      { parentId: 'root-1', childId: 'wallet-1' },
      { parentId: 'root-1', childId: 'workout-1' }
    ];

    const result = compileSharePolicyCore({
      policies,
      selectors,
      principals,
      registryItems,
      links,
      now: NOW
    });

    expect(result.decisions).toEqual([
      {
        itemId: 'wallet-1',
        principalType: 'user',
        principalId: 'alice',
        decision: 'deny',
        accessLevel: 'read',
        policyId: 'policy-a',
        selectorId: 'sel-exclude-wallet',
        precedence: 20
      },
      {
        itemId: 'workout-1',
        principalType: 'user',
        principalId: 'alice',
        decision: 'allow',
        accessLevel: 'read',
        policyId: 'policy-a',
        selectorId: 'sel-include',
        precedence: 10
      }
    ]);
  });

  it('chooses the highest access level across matching include selectors', () => {
    const policies = [
      activePolicy('policy-a', 'root-1'),
      activePolicy('policy-b', 'root-1')
    ];
    const selectors: SharePolicySelectorDefinition[] = [
      {
        id: 'sel-a',
        policyId: 'policy-a',
        selectorKind: 'include',
        matchMode: 'exact',
        anchorItemId: 'wallet-1',
        maxDepth: null,
        includeRoot: true,
        objectTypes: null,
        selectorOrder: 1
      },
      {
        id: 'sel-b',
        policyId: 'policy-b',
        selectorKind: 'include',
        matchMode: 'exact',
        anchorItemId: 'wallet-1',
        maxDepth: null,
        includeRoot: true,
        objectTypes: null,
        selectorOrder: 1
      }
    ];
    const principals: SharePolicyPrincipalDefinition[] = [
      {
        id: 'principal-a',
        policyId: 'policy-a',
        principalType: 'user',
        principalId: 'alice',
        accessLevel: 'read'
      },
      {
        id: 'principal-b',
        policyId: 'policy-b',
        principalType: 'user',
        principalId: 'alice',
        accessLevel: 'admin'
      }
    ];
    const registryItems: RegistryItemType[] = [
      { id: 'root-1', objectType: 'contact' },
      { id: 'wallet-1', objectType: 'walletItem' }
    ];
    const links: LinkEdge[] = [{ parentId: 'root-1', childId: 'wallet-1' }];

    const result = compileSharePolicyCore({
      policies,
      selectors,
      principals,
      registryItems,
      links,
      now: NOW
    });

    expect(result.decisions).toEqual([
      {
        itemId: 'wallet-1',
        principalType: 'user',
        principalId: 'alice',
        decision: 'allow',
        accessLevel: 'admin',
        policyId: 'policy-b',
        selectorId: 'sel-b',
        precedence: 1
      }
    ]);
  });

  it('enforces root-scope containment even when selector anchor is outside root', () => {
    const policies = [activePolicy('policy-a', 'root-1')];
    const selectors: SharePolicySelectorDefinition[] = [
      {
        id: 'sel-outside',
        policyId: 'policy-a',
        selectorKind: 'include',
        matchMode: 'subtree',
        anchorItemId: 'outside-root',
        maxDepth: null,
        includeRoot: true,
        objectTypes: null,
        selectorOrder: 1
      }
    ];
    const principals: SharePolicyPrincipalDefinition[] = [
      {
        id: 'principal-a',
        policyId: 'policy-a',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      }
    ];
    const registryItems: RegistryItemType[] = [
      { id: 'root-1', objectType: 'contact' },
      { id: 'inside-1', objectType: 'walletItem' },
      { id: 'outside-root', objectType: 'folder' },
      { id: 'outside-child', objectType: 'note' }
    ];
    const links: LinkEdge[] = [
      { parentId: 'root-1', childId: 'inside-1' },
      { parentId: 'outside-root', childId: 'outside-child' }
    ];

    const result = compileSharePolicyCore({
      policies,
      selectors,
      principals,
      registryItems,
      links,
      now: NOW
    });

    expect(result.decisions).toEqual([]);
  });

  it('applies depth and object-type filters deterministically', () => {
    const policies = [activePolicy('policy-a', 'root-1')];
    const selectors: SharePolicySelectorDefinition[] = [
      {
        id: 'sel-filtered',
        policyId: 'policy-a',
        selectorKind: 'include',
        matchMode: 'subtree',
        anchorItemId: null,
        maxDepth: 1,
        includeRoot: true,
        objectTypes: ['contact', 'folder'],
        selectorOrder: 5
      }
    ];
    const principals: SharePolicyPrincipalDefinition[] = [
      {
        id: 'principal-a',
        policyId: 'policy-a',
        principalType: 'organization',
        principalId: 'org-1',
        accessLevel: 'write'
      }
    ];
    const registryItems: RegistryItemType[] = [
      { id: 'root-1', objectType: 'contact' },
      { id: 'folder-1', objectType: 'folder' },
      { id: 'note-1', objectType: 'note' },
      { id: 'deep-note', objectType: 'note' }
    ];
    const links: LinkEdge[] = [
      { parentId: 'root-1', childId: 'folder-1' },
      { parentId: 'root-1', childId: 'note-1' },
      { parentId: 'folder-1', childId: 'deep-note' }
    ];

    const result = compileSharePolicyCore({
      policies,
      selectors,
      principals,
      registryItems,
      links,
      now: NOW
    });

    expect(result.decisions).toEqual([
      {
        itemId: 'folder-1',
        principalType: 'organization',
        principalId: 'org-1',
        decision: 'allow',
        accessLevel: 'write',
        policyId: 'policy-a',
        selectorId: 'sel-filtered',
        precedence: 5
      },
      {
        itemId: 'root-1',
        principalType: 'organization',
        principalId: 'org-1',
        decision: 'allow',
        accessLevel: 'write',
        policyId: 'policy-a',
        selectorId: 'sel-filtered',
        precedence: 5
      }
    ]);
  });

  it('skips inactive policies based on status/revocation/expiry', () => {
    const policies: SharePolicyDefinition[] = [
      activePolicy('policy-active', 'root-1'),
      {
        id: 'policy-draft',
        rootItemId: 'root-1',
        status: 'draft',
        revokedAt: null,
        expiresAt: null
      },
      {
        id: 'policy-revoked',
        rootItemId: 'root-1',
        status: 'active',
        revokedAt: new Date('2026-02-01T00:00:00.000Z'),
        expiresAt: null
      },
      {
        id: 'policy-expired',
        rootItemId: 'root-1',
        status: 'active',
        revokedAt: null,
        expiresAt: new Date('2026-02-01T00:00:00.000Z')
      }
    ];
    const selectors: SharePolicySelectorDefinition[] = policies.map(
      (policy, idx) => ({
        id: `sel-${policy.id}`,
        policyId: policy.id,
        selectorKind: 'include',
        matchMode: 'exact',
        anchorItemId: 'item-1',
        maxDepth: null,
        includeRoot: true,
        objectTypes: null,
        selectorOrder: idx + 1
      })
    );
    const principals: SharePolicyPrincipalDefinition[] = policies.map(
      (policy) => ({
        id: `principal-${policy.id}`,
        policyId: policy.id,
        principalType: 'user',
        principalId: 'alice',
        accessLevel: 'read'
      })
    );
    const registryItems: RegistryItemType[] = [
      { id: 'root-1', objectType: 'contact' },
      { id: 'item-1', objectType: 'walletItem' }
    ];
    const links: LinkEdge[] = [{ parentId: 'root-1', childId: 'item-1' }];

    const result = compileSharePolicyCore({
      policies,
      selectors,
      principals,
      registryItems,
      links,
      now: NOW
    });

    expect(result.policyCount).toBe(4);
    expect(result.activePolicyCount).toBe(1);
    expect(result.decisions).toEqual([
      {
        itemId: 'item-1',
        principalType: 'user',
        principalId: 'alice',
        decision: 'allow',
        accessLevel: 'read',
        policyId: 'policy-active',
        selectorId: 'sel-policy-active',
        precedence: 1
      }
    ]);
  });
});
