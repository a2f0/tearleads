import { describe, expect, it } from 'vitest';
import {
  compileSharePolicyCore,
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

describe('compileSharePolicyCore container roots', () => {
  it('skips policies rooted at unsupported non-container object types', () => {
    const policies = [activePolicy('policy-note-root', 'note-root')];
    const selectors: SharePolicySelectorDefinition[] = [
      {
        id: 'sel-note-root',
        policyId: 'policy-note-root',
        selectorKind: 'include',
        matchMode: 'exact',
        anchorItemId: null,
        maxDepth: null,
        includeRoot: true,
        objectTypes: null,
        selectorOrder: 1
      }
    ];
    const principals: SharePolicyPrincipalDefinition[] = [
      {
        id: 'principal-note-root',
        policyId: 'policy-note-root',
        principalType: 'user',
        principalId: 'alice',
        accessLevel: 'read'
      }
    ];
    const registryItems: RegistryItemType[] = [
      { id: 'note-root', objectType: 'note' }
    ];

    const result = compileSharePolicyCore({
      policies,
      selectors,
      principals,
      registryItems,
      links: [],
      now: NOW
    });

    expect(result.policyCount).toBe(1);
    expect(result.activePolicyCount).toBe(0);
    expect(result.decisions).toEqual([]);
  });

  it('supports folder, album, emailFolder, and contactGroup roots', () => {
    const policies: SharePolicyDefinition[] = [
      activePolicy('policy-folder', 'folder-root'),
      activePolicy('policy-album', 'album-root'),
      activePolicy('policy-email', 'email-root'),
      activePolicy('policy-contact-group', 'contact-group-root')
    ];
    const selectors: SharePolicySelectorDefinition[] = policies.map(
      (policy, index) => ({
        id: `sel-${policy.id}`,
        policyId: policy.id,
        selectorKind: 'include',
        matchMode: 'exact',
        anchorItemId: null,
        maxDepth: null,
        includeRoot: true,
        objectTypes: null,
        selectorOrder: index + 1
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
      { id: 'contact-group-root', objectType: 'contactGroup' },
      { id: 'email-root', objectType: 'emailFolder' },
      { id: 'folder-root', objectType: 'folder' },
      { id: 'album-root', objectType: 'album' }
    ];

    const result = compileSharePolicyCore({
      policies,
      selectors,
      principals,
      registryItems,
      links: [],
      now: NOW
    });

    expect(result.activePolicyCount).toBe(4);
    expect(result.decisions).toEqual([
      {
        itemId: 'album-root',
        principalType: 'user',
        principalId: 'alice',
        decision: 'allow',
        accessLevel: 'read',
        policyId: 'policy-album',
        selectorId: 'sel-policy-album',
        precedence: 2
      },
      {
        itemId: 'contact-group-root',
        principalType: 'user',
        principalId: 'alice',
        decision: 'allow',
        accessLevel: 'read',
        policyId: 'policy-contact-group',
        selectorId: 'sel-policy-contact-group',
        precedence: 4
      },
      {
        itemId: 'email-root',
        principalType: 'user',
        principalId: 'alice',
        decision: 'allow',
        accessLevel: 'read',
        policyId: 'policy-email',
        selectorId: 'sel-policy-email',
        precedence: 3
      },
      {
        itemId: 'folder-root',
        principalType: 'user',
        principalId: 'alice',
        decision: 'allow',
        accessLevel: 'read',
        policyId: 'policy-folder',
        selectorId: 'sel-policy-folder',
        precedence: 1
      }
    ]);
  });
});
