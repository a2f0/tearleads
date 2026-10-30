import { and, eq, sql } from "drizzle-orm";
import {
  principalHistoryNodeReferences,
  principalHistoryRootOwners,
} from "../../sqlite/schema/principalHistoryNodeRetentionSchema";
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
    .insert(principalHistoryNodeReferences)
    .values({
      ...scope,
      hash,
      referenceCount: 1,
      managed: false,
      leftHash: null,
      rightHash: null,
    })
    .onConflictDoUpdate({
      target: [
        principalHistoryNodeReferences.scopeId,
        principalHistoryNodeReferences.hash,
      ],
      set: {
        referenceCount: sql`${principalHistoryNodeReferences.referenceCount} + 1`,
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
    .update(principalHistoryNodeReferences)
    .set({
      referenceCount: sql`max(${principalHistoryNodeReferences.referenceCount} - 1, 0)`,
    })
    .where(
      and(
        eq(principalHistoryNodeReferences.scopeId, scope.scopeId),
        eq(principalHistoryNodeReferences.organizationId, scope.organizationId),
        eq(principalHistoryNodeReferences.hash, hash),
      ),
    )
    .run();
}

type PrincipalHistoryRootOwner = typeof principalHistoryRootOwners.$inferSelect;

type PrincipalHistoryRootInput = PrincipalHistoryNodeScope & {
  readonly id: string;
  readonly rootHash: string;
};

/** An owner whose root changes: the new root gains an edge, the old one loses it. */
export interface PrincipalHistoryRootRetention {
  readonly input: PrincipalHistoryRootInput;
  readonly previous: PrincipalHistoryRootOwner | undefined;
}

/** The root edges a node write replays itself, after its nodes and in this order. */
export interface PrincipalHistoryRootEdges {
  readonly increment: string;
  readonly decrement: string | null;
}

/** Null when the owner already holds this exact root, which changes nothing. */
export async function loadPrincipalHistoryRootRetention(
  tx: ClientSQLiteTransactionScope,
  input: PrincipalHistoryRootInput,
): Promise<PrincipalHistoryRootRetention | null> {
  const [previous] = await tx
    .select()
    .from(principalHistoryRootOwners)
    .where(eq(principalHistoryRootOwners.id, input.id))
    .limit(1);
  if (
    previous?.scopeId === input.scopeId &&
    previous.organizationId === input.organizationId &&
    previous.rootHash === input.rootHash
  )
    return null;
  return { input: { ...input }, previous };
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
 * Records the owner and applies the root edges `folded` did not already
 * write. Caller commits ownership together with the exact saved progress it
 * describes.
 */
export async function writePrincipalHistoryRootRetention(
  tx: ClientSQLiteTransactionScope,
  retention: PrincipalHistoryRootRetention | null,
  folded?: PrincipalHistoryRootEdges | undefined,
) {
  if (!retention) return;
  const { input, previous } = retention;
  if (!folded)
    await incrementPrincipalHistoryNodeReference(tx, input, input.rootHash);
  await tx
    .insert(principalHistoryRootOwners)
    .values(input)
    .onConflictDoUpdate({
      target: principalHistoryRootOwners.id,
      set: input,
    })
    .run();
  if (previous && !folded?.decrement)
    await decrementPrincipalHistoryNodeReference(
      tx,
      previous,
      previous.rootHash,
    );
}

/** Caller commits ownership together with the exact saved progress it describes. */
export async function retainPrincipalHistoryRoot(
  tx: ClientSQLiteTransactionScope,
  input: PrincipalHistoryRootInput,
) {
  await writePrincipalHistoryRootRetention(
    tx,
    await loadPrincipalHistoryRootRetention(tx, input),
  );
}

export async function releasePrincipalHistoryRoot(
  tx: ClientSQLiteTransactionScope,
  id: string,
) {
  const [previous] = await tx
    .select()
    .from(principalHistoryRootOwners)
    .where(eq(principalHistoryRootOwners.id, id))
    .limit(1);
  if (!previous) return;
  await tx
    .delete(principalHistoryRootOwners)
    .where(eq(principalHistoryRootOwners.id, id))
    .run();
  await decrementPrincipalHistoryNodeReference(tx, previous, previous.rootHash);
}
