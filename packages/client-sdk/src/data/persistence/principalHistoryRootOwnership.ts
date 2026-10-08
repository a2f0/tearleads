import { and, eq, sql } from "drizzle-orm";
import {
  principalHistoryNodeReferences,
  principalHistoryRootOwners,
} from "../sqlite/principalHistoryNodeRetentionSchema";
import type { ClientSQLiteTransactionScope } from "../sqlite/sqlitePersistenceRuntime";

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

/** Caller commits ownership together with the exact saved progress it describes. */
export async function retainPrincipalHistoryRoot(
  tx: ClientSQLiteTransactionScope,
  input: PrincipalHistoryNodeScope & {
    readonly id: string;
    readonly rootHash: string;
  },
) {
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
    return;
  await incrementPrincipalHistoryNodeReference(tx, input, input.rootHash);
  await tx
    .insert(principalHistoryRootOwners)
    .values(input)
    .onConflictDoUpdate({
      target: principalHistoryRootOwners.id,
      set: input,
    })
    .run();
  if (previous)
    await decrementPrincipalHistoryNodeReference(
      tx,
      previous,
      previous.rootHash,
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
