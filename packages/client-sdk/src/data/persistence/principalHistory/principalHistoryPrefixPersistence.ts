import { and, eq } from "drizzle-orm";
import { principalHistoryPrefixes } from "../../sqlite/schema/principalHistoryEvidenceSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { archivePrincipalHistoryKeyEnvelopes } from "../principalKeys/principalKeyEnvelopeArchivePersistence";
import { reclaimPrincipalHistoryNodes } from "./principalHistoryNodeRetention";
import {
  principalHistoryPrefixRootOwnerColumns,
  principalHistoryRootRetention,
  releasePrincipalHistoryRoot,
  writePrincipalHistoryRootEdges,
} from "./principalHistoryRootOwnership";
import { reclaimCompletedPrincipalHistoryStages } from "./principalHistoryStageRetention";

export type PrincipalHistoryPrefix = Omit<
  typeof principalHistoryPrefixes.$inferSelect,
  "rootHash" | "identityBundleFormat"
>;

export const principalHistoryPrefixColumns = {
  scopeId: principalHistoryPrefixes.scopeId,
  organizationId: principalHistoryPrefixes.organizationId,
  version: principalHistoryPrefixes.version,
  headJson: principalHistoryPrefixes.headJson,
  currentJson: principalHistoryPrefixes.currentJson,
  progress: principalHistoryPrefixes.progress,
};

/**
 * Preserve identical completed progress; this sink does not authenticate hints.
 * Callers must discard an unreadable prefix or identify it with rejectedPrefix
 * before publishing a repair of the same head and current artifacts. Updates
 * the owned `prefix` copy's progress when it reuses the stored progress.
 */
export async function savePrincipalHistoryPrefixInTransaction(
  tx: ClientSQLiteTransactionScope,
  prefix: PrincipalHistoryPrefix,
  indexRootHash: string,
  rejected: PrincipalHistoryPrefix | null,
): Promise<void> {
  const [previous] = await tx
    .select()
    .from(principalHistoryPrefixes)
    .where(eq(principalHistoryPrefixes.scopeId, prefix.scopeId))
    .limit(1);
  const replacesRejected =
    previous &&
    rejected?.scopeId === previous.scopeId &&
    rejected.progress === previous.progress;
  if (previous && previous.version > prefix.version && !replacesRejected)
    return;
  if (
    previous &&
    previous.version === prefix.version &&
    previous.organizationId === prefix.organizationId &&
    previous.headJson === prefix.headJson &&
    previous.currentJson === prefix.currentJson &&
    !replacesRejected
  ) {
    // Resealing an unchanged prefix would invalidate an acknowledgement's
    // progress CAS even though its authenticated predecessor is unchanged.
    // Still refresh authenticated root ownership and retention below.
    // Reuse authenticates this opaque progress; rejected hints are removed
    // or explicitly replaced before repair can rely on the new prefix.
    prefix.progress = previous.progress;
  }
  // Archiving reads only these three fields, so an identical previous
  // prefix would repeat the same idempotent write.
  if (
    previous &&
    (previous.organizationId !== prefix.organizationId ||
      previous.currentJson !== prefix.currentJson ||
      previous.version !== prefix.version)
  )
    await archivePrincipalHistoryKeyEnvelopes(tx, previous);
  await archivePrincipalHistoryKeyEnvelopes(tx, prefix);
  const root = {
    scopeId: prefix.scopeId,
    organizationId: prefix.organizationId,
    rootHash: indexRootHash,
  };
  const row = { ...prefix, rootHash: indexRootHash };
  await tx
    .insert(principalHistoryPrefixes)
    .values(row)
    .onConflictDoUpdate({
      target: principalHistoryPrefixes.scopeId,
      set: row,
    })
    .run();
  await reclaimCompletedPrincipalHistoryStages(tx, prefix);
  await writePrincipalHistoryRootEdges(
    tx,
    principalHistoryRootRetention(previous, root),
  );
  await reclaimPrincipalHistoryNodes(tx, prefix);
}

/** Invalid hints are disposable, but a losing reader must preserve a newer hint. */
export async function discardPrincipalHistoryPrefixInTransaction(
  tx: ClientSQLiteTransactionScope,
  prefix: PrincipalHistoryPrefix,
): Promise<void> {
  const [current] = await tx
    .select({
      progress: principalHistoryPrefixes.progress,
      ...principalHistoryPrefixRootOwnerColumns,
    })
    .from(principalHistoryPrefixes)
    .where(eq(principalHistoryPrefixes.scopeId, prefix.scopeId))
    .limit(1);
  if (!current || current.progress !== prefix.progress) return;
  await releasePrincipalHistoryRoot(tx, current);
  await tx
    .delete(principalHistoryPrefixes)
    .where(
      and(
        eq(principalHistoryPrefixes.scopeId, prefix.scopeId),
        eq(principalHistoryPrefixes.progress, prefix.progress),
      ),
    )
    .run();
}
