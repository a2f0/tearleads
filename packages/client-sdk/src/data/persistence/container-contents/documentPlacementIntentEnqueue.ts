import { eq } from "drizzle-orm";
import { uniqueSortedStrings } from "../../documents/shared/readers";
import { documentIntentLinkTargets } from "../../sqlite/documentPlacementIntentSchema";
import {
  documentMoveIntents,
  documentMoveIntentTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";

interface PlacementIntentInput {
  id?: string | undefined;
  documentId: string;
  localId: string;
  replaceLinkedContainers?: boolean | undefined;
  sourceContainerId?: string | null | undefined;
  targetContainerId: string;
}

export async function loadDocumentIntentLinkTargets(
  execSql: ExecSql,
  intentId: string,
): Promise<string[]> {
  const rows = await getClientSQLitePersistenceRuntime(execSql)
    .db.select({ containerId: documentIntentLinkTargets.containerId })
    .from(documentIntentLinkTargets)
    .where(eq(documentIntentLinkTargets.intentId, intentId));
  return uniqueSortedStrings(rows.map((row) => row.containerId));
}

function resolvePlacement(
  input: PlacementIntentInput,
  previous: typeof documentMoveIntents.$inferSelect | undefined,
  linkOnly: boolean,
) {
  const sourceContainerId =
    previous && previous.sourceContainerId !== previous.targetContainerId
      ? (previous.sourceContainerId ?? input.sourceContainerId ?? null)
      : (input.sourceContainerId ?? null);
  return {
    sourceContainerId: linkOnly
      ? (previous?.sourceContainerId ?? input.sourceContainerId ?? null)
      : sourceContainerId,
    targetContainerId: linkOnly
      ? (previous?.targetContainerId ??
        input.sourceContainerId ??
        input.targetContainerId)
      : input.targetContainerId,
    replaceLinkedContainers:
      previous?.replaceLinkedContainers ||
      (input.replaceLinkedContainers ?? false),
  };
}

async function enqueuePlacementIntent(
  execSql: ExecSql,
  input: PlacementIntentInput,
  linkOnly: boolean,
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureSqlTables(lockedExecSql, documentMoveIntentTables);
    const runtime = getClientSQLitePersistenceRuntime(lockedExecSql);
    await runtime.transaction(async (tx) => {
      const [previous] = await tx
        .select()
        .from(documentMoveIntents)
        .where(eq(documentMoveIntents.documentId, input.documentId))
        .limit(1);
      const previousTargets = previous?.id
        ? await loadDocumentIntentLinkTargets(lockedExecSql, previous.id)
        : [];
      const targets = linkOnly
        ? uniqueSortedStrings([...previousTargets, input.targetContainerId])
        : input.replaceLinkedContainers
          ? []
          : previousTargets.filter((id) => id !== input.sourceContainerId);
      const id = input.id ?? crypto.randomUUID();
      const updatedAt = new Date().toISOString();
      // An additive intent retains the active placement and any pending move.
      // Its targets are separate from the discovery projection: only explicit
      // user additions may be replayed, never stale server-discovered links.
      const next = {
        id,
        documentId: input.documentId,
        localId: input.localId,
        intentType: "document.move",
        lastAttemptedAt: null,
        lastError: null,
        syncStatus: "pending",
        updatedAt,
        ...resolvePlacement(input, previous, linkOnly),
      };
      await tx
        .insert(documentMoveIntents)
        .values({ ...next, createdAt: updatedAt })
        .onConflictDoUpdate({
          target: documentMoveIntents.documentId,
          set: next,
        })
        .run();
      if (previous?.id)
        await tx
          .delete(documentIntentLinkTargets)
          .where(eq(documentIntentLinkTargets.intentId, previous.id))
          .run();
      if (targets.length)
        await tx
          .insert(documentIntentLinkTargets)
          .values(targets.map((containerId) => ({ intentId: id, containerId })))
          .run();
    });
  });
}

export function enqueueDocumentMoveIntent(
  execSql: ExecSql,
  input: PlacementIntentInput,
): Promise<void> {
  return enqueuePlacementIntent(execSql, input, false);
}

export function enqueueDocumentLinkIntent(
  execSql: ExecSql,
  input: PlacementIntentInput & { sourceContainerId: string },
): Promise<void> {
  return enqueuePlacementIntent(execSql, input, true);
}
