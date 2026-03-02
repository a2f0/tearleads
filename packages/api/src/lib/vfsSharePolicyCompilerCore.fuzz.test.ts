import { describe, expect, it } from 'vitest';
import {
  compileSharePolicyCore,
  type LinkEdge,
  type RegistryItemType,
  type SharePolicyDefinition,
  type SharePolicyPrincipalDefinition,
  type SharePolicySelectorDefinition
} from './vfsSharePolicyCompilerCore.js';

const NOW = new Date('2026-03-01T00:00:00.000Z');

function createRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(values: readonly T[], rng: () => number): T {
  const index = Math.floor(rng() * values.length);
  const value = values[index];
  if (value === undefined) {
    throw new Error('Failed to pick value from input list');
  }
  return value;
}

function shuffle<T>(values: readonly T[], rng: () => number): T[] {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const current = output[index];
    const swap = output[swapIndex];
    if (current === undefined || swap === undefined) {
      throw new Error('Failed to read shuffle values');
    }
    output[index] = swap;
    output[swapIndex] = current;
  }
  return output;
}

interface CoreInput {
  policies: SharePolicyDefinition[];
  selectors: SharePolicySelectorDefinition[];
  principals: SharePolicyPrincipalDefinition[];
  registryItems: RegistryItemType[];
  links: LinkEdge[];
}

function buildScenario(seed: number): CoreInput {
  const rng = createRng(seed);
  const rootIds = ['root-0', 'root-1', 'root-2'];
  const itemIds = Array.from({ length: 15 }, (_, index) => `item-${index}`);
  const allItemIds = [...rootIds, ...itemIds];

  const nonContainerObjectTypes = ['walletItem', 'healthWorkoutEntry', 'note'];
  const registryItems: RegistryItemType[] = [
    { id: 'root-0', objectType: 'contact' },
    { id: 'root-1', objectType: 'playlist' },
    { id: 'root-2', objectType: 'contact' },
    ...itemIds.map((itemId) => ({
      id: itemId,
      objectType: pick(nonContainerObjectTypes, rng)
    }))
  ];

  const links: LinkEdge[] = [];
  const availableParents = [...rootIds];
  for (const itemId of itemIds) {
    const parentId = pick(availableParents, rng);
    links.push({ parentId, childId: itemId });
    availableParents.push(itemId);
  }

  const policyStatuses: Array<'active' | 'paused'> = [
    'active',
    'active',
    'paused'
  ];
  const policies: SharePolicyDefinition[] = Array.from(
    { length: 4 },
    (_, index) => ({
      id: `policy-${index}`,
      rootItemId: pick(rootIds, rng),
      status: pick(policyStatuses, rng),
      revokedAt: null,
      expiresAt: null
    })
  );

  const selectorKinds: Array<'include' | 'exclude'> = ['include', 'exclude'];
  const matchModes: Array<'subtree' | 'children' | 'exact'> = [
    'subtree',
    'children',
    'exact'
  ];
  const selectors: SharePolicySelectorDefinition[] = [];
  for (const policy of policies) {
    for (let order = 0; order < 3; order += 1) {
      const anchorOrNull = rng() < 0.5 ? null : pick(allItemIds, rng);
      selectors.push({
        id: `${policy.id}-selector-${order}`,
        policyId: policy.id,
        selectorKind: pick(selectorKinds, rng),
        matchMode: pick(matchModes, rng),
        anchorItemId: anchorOrNull,
        maxDepth: rng() < 0.4 ? Math.floor(rng() * 3) : null,
        includeRoot: rng() < 0.5,
        objectTypes: rng() < 0.5 ? null : [pick(nonContainerObjectTypes, rng)],
        selectorOrder: order + 1
      });
    }
  }

  const principalTypes: Array<'user' | 'group' | 'organization'> = [
    'user',
    'group',
    'organization'
  ];
  const accessLevels: Array<'read' | 'write' | 'admin'> = [
    'read',
    'write',
    'admin'
  ];
  const principals: SharePolicyPrincipalDefinition[] = [];
  for (const policy of policies) {
    for (let index = 0; index < 3; index += 1) {
      principals.push({
        id: `${policy.id}-principal-${index}`,
        policyId: policy.id,
        principalType: pick(principalTypes, rng),
        principalId: `principal-${Math.floor(rng() * 6)}`,
        accessLevel: pick(accessLevels, rng)
      });
    }
  }

  return {
    policies,
    selectors,
    principals,
    registryItems,
    links
  };
}

describe('compileSharePolicyCore deterministic fuzz', () => {
  it('returns identical results for permuted equivalent inputs', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const input = buildScenario(seed);

      const baseline = compileSharePolicyCore({
        ...input,
        now: NOW
      });

      const shuffleRng = createRng(seed * 17 + 11);
      const permuted = compileSharePolicyCore({
        policies: shuffle(input.policies, shuffleRng),
        selectors: shuffle(input.selectors, shuffleRng),
        principals: shuffle(input.principals, shuffleRng),
        registryItems: shuffle(input.registryItems, shuffleRng),
        links: shuffle(input.links, shuffleRng),
        now: NOW
      });

      expect(permuted).toEqual(baseline);
    }
  });
});
