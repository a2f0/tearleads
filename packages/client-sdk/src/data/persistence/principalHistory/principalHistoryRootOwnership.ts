import { and, eq, inArray, sql } from "drizzle-orm";
import {
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "../../sqlite/schema/principalHistoryEvidenceSchema";
import { principalHistoryStages } from "../../sqlite/schema/principalHistoryStageSchema";
import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

export interface PrincipalHistoryNodeScope {
  /** Evidence scope hashes include organizationId; one scope belongs to one organization. */
  readonly scopeId: string;
  readonly organizationId: string;
}

export async function incrementPrincipalHistoryNodeReference(
  tx: ClientSQLiteTransactionScope,
  scope: PrincipalHistoryNodeScope,
  hash: string,
) {
  await tx
    .insert(principalHistoryNodes)
    .values({
      ...scope,
      hash,
      referenceCount: 1,
      managed: false,
      leftHash: null,
      rightHash: null,
    })
    .onConflictDoUpdate({
      target: [principalHistoryNodes.scopeId, principalHistoryNodes.hash],
      set: {
        referenceCount: sql`${principalHistoryNodes.referenceCount} + 1`,
      },
    })
    .run();
}

export async function decrementPrincipalHistoryNodeReference(
  tx: ClientSQLiteTransactionScope,
  scope: PrincipalHistoryNodeScope,
  hash: string,
) {
  await tx
    .update(principalHistoryNodes)
    .set({
      referenceCount: sql`max(${principalHistoryNodes.referenceCount} - 1, 0)`,
    })
    .where(
      and(
        eq(principalHistoryNodes.scopeId, scope.scopeId),
        eq(principalHistoryNodes.organizationId, scope.organizationId),
        eq(principalHistoryNodes.hash, hash),
      ),
    )
    .run();
}

/** A root a saved stage or prefix row keeps live through its `rootHash`. */
export interface PrincipalHistoryRoot extends PrincipalHistoryNodeScope {
  readonly rootHash: string;
}

/** A saved stage or prefix row's scope and root column, as read before its write. */
export interface PrincipalHistoryRootOwner extends PrincipalHistoryNodeScope {
  readonly rootHash: string | null;
}

/** A stage row's root owner columns. */
export const principalHistoryStageRootOwnerColumns = {
  scopeId: principalHistoryStages.scopeId,
  organizationId: principalHistoryStages.organizationId,
  rootHash: principalHistoryStages.rootHash,
};

/** A prefix row's root owner columns. */
export const principalHistoryPrefixRootOwnerColumns = {
  scopeId: principalHistoryPrefixes.scopeId,
  organizationId: principalHistoryPrefixes.organizationId,
  rootHash: principalHistoryPrefixes.rootHash,
};

/** An owner whose root changes: the new root gains an edge, the old one loses it. */
export interface PrincipalHistoryRootRetention {
  readonly input: PrincipalHistoryRoot;
  readonly previous: PrincipalHistoryRoot | undefined;
}

/** The root edges a node write replays itself, after its nodes and in this order. */
export interface PrincipalHistoryRootEdges {
  readonly increment: string;
  readonly decrement: string | null;
}

function ownedRoot(
  owner: PrincipalHistoryRootOwner | undefined,
): PrincipalHistoryRoot | undefined {
  if (!owner?.rootHash) return undefined;
  return {
    scopeId: owner.scopeId,
    organizationId: owner.organizationId,
    rootHash: owner.rootHash,
  };
}

/**
 * The edges that move an owner row from `previous` (read before the row's
 * write) to `input`. Null when the row already holds this exact root, which
 * changes nothing.
 */
export function principalHistoryRootRetention(
  previous: PrincipalHistoryRootOwner | undefined,
  input: PrincipalHistoryRoot,
): PrincipalHistoryRootRetention | null {
  const owned = ownedRoot(previous);
  if (
    owned?.scopeId === input.scopeId &&
    owned.organizationId === input.organizationId &&
    owned.rootHash === input.rootHash
  )
    return null;
  return { input: { ...input }, previous: owned };
}

function sameScope(
  left: PrincipalHistoryNodeScope,
  right: PrincipalHistoryNodeScope,
): boolean {
  return (
    left.scopeId === right.scopeId &&
    left.organizationId === right.organizationId
  );
}

/**
 * The edges a write of `page`'s nodes can apply for this retention without
 * reordering them: the increment only when the owner is in the page's scope,
 * and the previous root's decrement only after it and in the same scope. A
 * page without nodes writes no liveness rows, so nothing folds into it.
 */
export function foldablePrincipalHistoryRootEdges(
  retention: PrincipalHistoryRootRetention | null,
  page: PrincipalHistoryNodeScope & { readonly nodes: readonly unknown[] },
): PrincipalHistoryRootEdges | undefined {
  if (
    !retention ||
    page.nodes.length === 0 ||
    !sameScope(retention.input, page)
  )
    return undefined;
  const { previous } = retention;
  return {
    increment: retention.input.rootHash,
    decrement: previous && sameScope(previous, page) ? previous.rootHash : null,
  };
}

/**
 * Applies the root edges `folded` did not already write: the new root's
 * increment, then the previous root's decrement. The caller writes the owner
 * row's `rootHash` in the same transaction as the exact saved progress it
 * describes.
 */
export async function writePrincipalHistoryRootEdges(
  tx: ClientSQLiteTransactionScope,
  retention: PrincipalHistoryRootRetention | null,
  folded?: PrincipalHistoryRootEdges | undefined,
) {
  if (!retention) return;
  const { input, previous } = retention;
  if (!folded)
    await incrementPrincipalHistoryNodeReference(tx, input, input.rootHash);
  if (previous && !folded?.decrement)
    await decrementPrincipalHistoryNodeReference(
      tx,
      previous,
      previous.rootHash,
    );
}

/** Releases a stage or prefix row's root; the caller deletes the row in the same transaction. */
export async function releasePrincipalHistoryRoot(
  tx: ClientSQLiteTransactionScope,
  owner: PrincipalHistoryRootOwner,
) {
  const owned = ownedRoot(owner);
  if (owned)
    await decrementPrincipalHistoryNodeReference(tx, owned, owned.rootHash);
}

/** Release scoped stage roots with the same floor as successive decrements. */
export async function releasePrincipalHistoryRoots(
  tx: ClientSQLiteTransactionScope,
  scope: PrincipalHistoryNodeScope,
  roots: readonly (string | null)[],
) {
  const multiplicity = new Map<string, number>();
  for (const hash of roots)
    if (hash) multiplicity.set(hash, (multiplicity.get(hash) ?? 0) + 1);
  const byCount = new Map<number, string[]>();
  for (const [hash, count] of multiplicity)
    byCount.set(count, [...(byCount.get(count) ?? []), hash]);
  // One bound count and two scope predicates accompany each hash list.
  const batchSize = sqliteRowsPerStatement(1, 3);
  for (const [count, hashes] of byCount)
    for (let offset = 0; offset < hashes.length; offset += batchSize)
      await tx
        .update(principalHistoryNodes)
        .set({
          referenceCount: sql`max(${principalHistoryNodes.referenceCount} - ${count}, 0)`,
        })
        .where(
          and(
            eq(principalHistoryNodes.scopeId, scope.scopeId),
            eq(principalHistoryNodes.organizationId, scope.organizationId),
            inArray(
              principalHistoryNodes.hash,
              hashes.slice(offset, offset + batchSize),
            ),
          ),
        )
        .run();
}
