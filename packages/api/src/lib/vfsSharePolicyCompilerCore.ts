import { VFS_CONTAINER_OBJECT_TYPES } from '@tearleads/shared';

type PolicyStatus = 'draft' | 'active' | 'paused' | 'revoked';

export type PolicySelectorKind = 'include' | 'exclude';
export type PolicySelectorMatchMode = 'subtree' | 'children' | 'exact';
export type PolicyPrincipalType = 'user' | 'group' | 'organization';
export type PolicyAccessLevel = 'read' | 'write' | 'admin';

export interface SharePolicyDefinition {
  id: string;
  rootItemId: string;
  status: PolicyStatus;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export interface SharePolicySelectorDefinition {
  id: string;
  policyId: string;
  selectorKind: PolicySelectorKind;
  matchMode: PolicySelectorMatchMode;
  anchorItemId: string | null;
  maxDepth: number | null;
  includeRoot: boolean;
  objectTypes: string[] | null;
  selectorOrder: number;
}

export interface SharePolicyPrincipalDefinition {
  id: string;
  policyId: string;
  principalType: PolicyPrincipalType;
  principalId: string;
  accessLevel: PolicyAccessLevel;
}

export interface RegistryItemType {
  id: string;
  objectType: string;
}

export interface LinkEdge {
  parentId: string;
  childId: string;
}

interface CompiledPolicyDecision {
  itemId: string;
  principalType: PolicyPrincipalType;
  principalId: string;
  decision: 'allow' | 'deny';
  accessLevel: PolicyAccessLevel;
  policyId: string;
  selectorId: string;
  precedence: number;
}

interface CompileSharePolicyCoreResult {
  decisions: CompiledPolicyDecision[];
  policyCount: number;
  activePolicyCount: number;
  selectorCount: number;
  principalCount: number;
  expandedMatchCount: number;
}

interface CompiledSource {
  policyId: string;
  selectorId: string;
  selectorOrder: number;
}

interface CompiledAggregate {
  itemId: string;
  principalType: PolicyPrincipalType;
  principalId: string;
  allowAccessLevel: PolicyAccessLevel | null;
  allowSource: CompiledSource | null;
  denySource: CompiledSource | null;
}

const ACCESS_RANK: Record<PolicyAccessLevel, number> = {
  read: 1,
  write: 2,
  admin: 3
};

function isPolicyPrincipalType(value: string): value is PolicyPrincipalType {
  return value === 'user' || value === 'group' || value === 'organization';
}

function buildChildrenMap(links: LinkEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const link of links) {
    const list = map.get(link.parentId);
    if (list) {
      list.push(link.childId);
    } else {
      map.set(link.parentId, [link.childId]);
    }
  }
  return map;
}

function buildItemTypeMap(
  registryItems: RegistryItemType[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of registryItems) {
    map.set(item.id, item.objectType);
  }
  return map;
}

interface TraverseOptions {
  includeRoot: boolean;
  minDepth: number;
  maxDepth: number | null;
}

function traverseFromAnchor(
  anchorId: string,
  childrenByParent: Map<string, string[]>,
  options: TraverseOptions
): Set<string> {
  const matched = new Set<string>();
  const bestDepth = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: anchorId, depth: 0 }
  ];
  bestDepth.set(anchorId, 0);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor] as { id: string; depth: number };
    const { id, depth } = current;
    if (options.maxDepth !== null && depth > options.maxDepth) {
      continue;
    }

    const shouldInclude =
      (depth === 0 ? options.includeRoot : depth >= options.minDepth) &&
      (options.maxDepth === null || depth <= options.maxDepth);
    if (shouldInclude) {
      matched.add(id);
    }

    if (options.maxDepth !== null && depth >= options.maxDepth) {
      continue;
    }
    const children = childrenByParent.get(id) ?? [];
    for (const childId of children) {
      const knownDepth = bestDepth.get(childId);
      const nextDepth = depth + 1;
      if (knownDepth !== undefined && knownDepth <= nextDepth) {
        continue;
      }
      bestDepth.set(childId, nextDepth);
      queue.push({ id: childId, depth: nextDepth });
    }
  }

  return matched;
}

function compareSource(left: CompiledSource, right: CompiledSource): number {
  if (left.selectorOrder !== right.selectorOrder) {
    return left.selectorOrder - right.selectorOrder;
  }
  if (left.policyId !== right.policyId) {
    return left.policyId.localeCompare(right.policyId);
  }
  return left.selectorId.localeCompare(right.selectorId);
}

function shouldReplaceAllow(
  currentLevel: PolicyAccessLevel | null,
  nextLevel: PolicyAccessLevel,
  currentSource: CompiledSource | null,
  nextSource: CompiledSource
): boolean {
  if (currentLevel === null || currentSource === null) {
    return true;
  }
  const currentRank = ACCESS_RANK[currentLevel];
  const nextRank = ACCESS_RANK[nextLevel];
  if (nextRank > currentRank) {
    return true;
  }
  if (nextRank < currentRank) {
    return false;
  }
  return compareSource(nextSource, currentSource) < 0;
}

function parseTypeFilter(objectTypes: string[] | null): Set<string> | null {
  if (!objectTypes || objectTypes.length === 0) {
    return null;
  }
  const filtered = objectTypes
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (filtered.length === 0) {
    return null;
  }
  return new Set(filtered);
}

function evaluateSelectorMatches(
  policy: SharePolicyDefinition,
  selector: SharePolicySelectorDefinition,
  childrenByParent: Map<string, string[]>,
  itemTypes: Map<string, string>,
  rootScope: Set<string>
): Set<string> {
  const anchorId = selector.anchorItemId ?? policy.rootItemId;
  if (!itemTypes.has(anchorId)) {
    return new Set<string>();
  }

  const maxDepth =
    selector.maxDepth !== null ? Math.max(0, selector.maxDepth) : null;
  const baseMatches =
    selector.matchMode === 'exact'
      ? traverseFromAnchor(anchorId, childrenByParent, {
          includeRoot: selector.includeRoot,
          minDepth: 0,
          maxDepth: 0
        })
      : selector.matchMode === 'children'
        ? traverseFromAnchor(anchorId, childrenByParent, {
            includeRoot: selector.includeRoot,
            minDepth: 1,
            maxDepth: maxDepth ?? 1
          })
        : traverseFromAnchor(anchorId, childrenByParent, {
            includeRoot: selector.includeRoot,
            minDepth: 1,
            maxDepth
          });

  const typeFilter = parseTypeFilter(selector.objectTypes);
  const scopedMatches = new Set<string>();
  for (const itemId of baseMatches) {
    if (!rootScope.has(itemId)) {
      continue;
    }
    if (typeFilter) {
      const objectType = itemTypes.get(itemId);
      if (!objectType || !typeFilter.has(objectType)) {
        continue;
      }
    }
    scopedMatches.add(itemId);
  }
  return scopedMatches;
}

function isPolicyActive(policy: SharePolicyDefinition, now: Date): boolean {
  if (policy.status !== 'active') {
    return false;
  }
  if (policy.revokedAt !== null) {
    return false;
  }
  if (
    policy.expiresAt !== null &&
    policy.expiresAt.getTime() <= now.getTime()
  ) {
    return false;
  }
  return true;
}

function aggregateKey(
  itemId: string,
  principalType: PolicyPrincipalType,
  principalId: string
): string {
  return JSON.stringify([itemId, principalType, principalId]);
}

function decodeAggregateKey(key: string): {
  itemId: string;
  principalType: PolicyPrincipalType;
  principalId: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    throw new Error(`Malformed aggregate key: ${key}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) {
    throw new Error(`Malformed aggregate key: ${key}`);
  }
  const [itemId, principalType, principalId] = parsed;
  if (
    typeof itemId !== 'string' ||
    typeof principalType !== 'string' ||
    typeof principalId !== 'string' ||
    !isPolicyPrincipalType(principalType)
  ) {
    throw new Error(`Malformed aggregate key: ${key}`);
  }
  return {
    itemId,
    principalType,
    principalId
  };
}

export function compileSharePolicyCore(input: {
  policies: SharePolicyDefinition[];
  selectors: SharePolicySelectorDefinition[];
  principals: SharePolicyPrincipalDefinition[];
  registryItems: RegistryItemType[];
  links: LinkEdge[];
  now: Date;
}): CompileSharePolicyCoreResult {
  const childrenByParent = buildChildrenMap(input.links);
  const itemTypes = buildItemTypeMap(input.registryItems);
  const containerTypes = new Set<string>(VFS_CONTAINER_OBJECT_TYPES);
  const aggregates = new Map<string, CompiledAggregate>();
  const activePolicies = input.policies
    .filter(
      (policy) =>
        isPolicyActive(policy, input.now) &&
        containerTypes.has(itemTypes.get(policy.rootItemId) ?? '')
    )
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  const selectorsByPolicy = new Map<string, SharePolicySelectorDefinition[]>();
  const principalsByPolicy = new Map<
    string,
    SharePolicyPrincipalDefinition[]
  >();
  for (const selector of input.selectors) {
    const list = selectorsByPolicy.get(selector.policyId);
    if (list) {
      list.push(selector);
    } else {
      selectorsByPolicy.set(selector.policyId, [selector]);
    }
  }
  for (const principal of input.principals) {
    const list = principalsByPolicy.get(principal.policyId);
    if (list) {
      list.push(principal);
    } else {
      principalsByPolicy.set(principal.policyId, [principal]);
    }
  }

  let expandedMatchCount = 0;
  for (const policy of activePolicies) {
    const policySelectors = (selectorsByPolicy.get(policy.id) ?? [])
      .slice()
      .sort((left, right) =>
        left.selectorOrder !== right.selectorOrder
          ? left.selectorOrder - right.selectorOrder
          : left.id.localeCompare(right.id)
      );
    const policyPrincipals = (principalsByPolicy.get(policy.id) ?? [])
      .slice()
      .sort((left, right) =>
        left.principalType !== right.principalType
          ? left.principalType.localeCompare(right.principalType)
          : left.principalId.localeCompare(right.principalId)
      );
    if (policySelectors.length === 0 || policyPrincipals.length === 0) {
      continue;
    }
    const rootScope = traverseFromAnchor(policy.rootItemId, childrenByParent, {
      includeRoot: true,
      minDepth: 0,
      maxDepth: null
    });

    for (const selector of policySelectors) {
      const matches = evaluateSelectorMatches(
        policy,
        selector,
        childrenByParent,
        itemTypes,
        rootScope
      );
      const matchedItemIds = Array.from(matches).sort((left, right) =>
        left.localeCompare(right)
      );
      expandedMatchCount += matchedItemIds.length;

      for (const principal of policyPrincipals) {
        const source: CompiledSource = {
          policyId: policy.id,
          selectorId: selector.id,
          selectorOrder: selector.selectorOrder
        };
        for (const itemId of matchedItemIds) {
          const key = aggregateKey(
            itemId,
            principal.principalType,
            principal.principalId
          );
          const aggregate = aggregates.get(key) ?? {
            itemId,
            principalType: principal.principalType,
            principalId: principal.principalId,
            allowAccessLevel: null,
            allowSource: null,
            denySource: null
          };
          if (selector.selectorKind === 'exclude') {
            if (
              !aggregate.denySource ||
              compareSource(source, aggregate.denySource) < 0
            ) {
              aggregate.denySource = source;
            }
          } else if (
            shouldReplaceAllow(
              aggregate.allowAccessLevel,
              principal.accessLevel,
              aggregate.allowSource,
              source
            )
          ) {
            aggregate.allowAccessLevel = principal.accessLevel;
            aggregate.allowSource = source;
          }
          aggregates.set(key, aggregate);
        }
      }
    }
  }

  const decisions: CompiledPolicyDecision[] = [];
  const sortedKeys = Array.from(aggregates.keys()).sort((left, right) =>
    left.localeCompare(right)
  );
  for (const key of sortedKeys) {
    const aggregate = aggregates.get(key) as CompiledAggregate;
    const decoded = decodeAggregateKey(key);
    if (aggregate.denySource) {
      decisions.push({
        itemId: decoded.itemId,
        principalType: decoded.principalType,
        principalId: decoded.principalId,
        decision: 'deny',
        accessLevel: aggregate.allowAccessLevel ?? 'read',
        policyId: aggregate.denySource.policyId,
        selectorId: aggregate.denySource.selectorId,
        precedence: aggregate.denySource.selectorOrder
      });
      continue;
    }
    if (aggregate.allowAccessLevel && aggregate.allowSource) {
      decisions.push({
        itemId: decoded.itemId,
        principalType: decoded.principalType,
        principalId: decoded.principalId,
        decision: 'allow',
        accessLevel: aggregate.allowAccessLevel,
        policyId: aggregate.allowSource.policyId,
        selectorId: aggregate.allowSource.selectorId,
        precedence: aggregate.allowSource.selectorOrder
      });
    }
  }

  return {
    decisions,
    policyCount: input.policies.length,
    activePolicyCount: activePolicies.length,
    selectorCount: input.selectors.length,
    principalCount: input.principals.length,
    expandedMatchCount
  };
}
