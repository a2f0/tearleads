import { and, eq } from "drizzle-orm";
import { uniqueSortedStrings } from "../../documents/shared/readers";
import { documentIntentLinkTargets } from "../../sqlite/documentPlacementIntentSchema";
import {
  documentContainerProjection,
  documentContainerProjectionTables,
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
  removedContainerId?: string | undefined;
  sourceContainerId?: string | null | undefined;
  targetContainerId: string;
}

export async function loadDocumentIntentLinkTargets(
  execSql: ExecSql,
  intentId: string,
) {
  return getClientSQLitePersistenceRuntime(execSql)
    .db.select({
      containerId: documentIntentLinkTargets.containerId,
      operation: documentIntentLinkTargets.operation,
    })
    .from(documentIntentLinkTargets)
    .where(eq(documentIntentLinkTargets.intentId, intentId));
}

type LinkTarget = { containerId: string; operation: "link" | "unlink" };

async function loadSurvivingMoveTarget(
  execSql: ExecSql,
  previous: typeof documentMoveIntents.$inferSelect | undefined,
): Promise<string | null> {
  if (previous?.intentType !== "document.move") return null;
  const [link] = await getClientSQLitePersistenceRuntime(execSql)
    .db.select({ containerId: documentContainerProjection.containerId })
    .from(documentContainerProjection)
    .where(
      and(
        eq(documentContainerProjection.documentId, previous.documentId),
        eq(documentContainerProjection.containerId, previous.targetContainerId),
      ),
    )
    .limit(1);
  return link?.containerId ?? null;
}

function resolveTargets(
  input: PlacementIntentInput,
  previous: LinkTarget[],
  operation: "move" | "link" | "unlink",
  previousMoveTarget: string | null,
): LinkTarget[] {
  const targets = new Map(
    previous.map((target) => [target.containerId, target.operation]),
  );
  if (operation === "link") targets.set(input.targetContainerId, "link");
  else if (operation === "unlink") {
    if (!input.removedContainerId)
      throw new Error("Unlink intent requires a removed container");
    targets.set(input.removedContainerId, "unlink");
  } else if (input.replaceLinkedContainers) targets.clear();
  else {
    if (
      previousMoveTarget &&
      previousMoveTarget !== input.sourceContainerId &&
      previousMoveTarget !== input.targetContainerId &&
      targets.get(previousMoveTarget) !== "unlink"
    ) {
      targets.set(previousMoveTarget, "link");
    }
    targets.delete(input.targetContainerId);
    if (
      input.sourceContainerId &&
      input.sourceContainerId !== input.targetContainerId
    )
      targets.set(input.sourceContainerId, "unlink");
  }
  return uniqueSortedStrings([...targets.keys()]).map((containerId) => ({
    containerId,
    operation: targets.get(containerId) ?? "link",
  }));
}

function resolvePlacement(
  input: PlacementIntentInput,
  previous: typeof documentMoveIntents.$inferSelect | undefined,
  operation: "move" | "link" | "unlink",
) {
  if (operation === "unlink") {
    return {
      sourceContainerId:
        previous?.intentType === "document.move"
          ? previous.sourceContainerId
          : input.targetContainerId,
      targetContainerId:
        previous?.intentType === "document.move" &&
        previous.targetContainerId !== input.removedContainerId
          ? previous.targetContainerId
          : input.targetContainerId,
      replaceLinkedContainers: previous?.replaceLinkedContainers ?? false,
    };
  }
  const linkOnly = operation === "link";
  const sourceContainerId =
    previous?.intentType === "document.move"
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
  operation: "move" | "link" | "unlink",
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureSqlTables(lockedExecSql, documentMoveIntentTables);
    await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
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
      const targets = resolveTargets(
        input,
        previousTargets,
        operation,
        operation === "move"
          ? await loadSurvivingMoveTarget(lockedExecSql, previous)
          : null,
      );
      const id = input.id ?? crypto.randomUUID();
      const updatedAt = new Date().toISOString();
      // An additive intent retains the active placement and any pending move.
      // Its targets are separate from the discovery projection: only explicit
      // user additions may be replayed, never stale server-discovered links.
      const next = {
        id,
        documentId: input.documentId,
        localId: input.localId,
        intentType:
          operation === "move" || previous?.intentType === "document.move"
            ? "document.move"
            : "document.link",
        lastAttemptedAt: null,
        lastError: null,
        syncStatus: "pending",
        updatedAt,
        ...resolvePlacement(input, previous, operation),
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
          .values(targets.map((target) => ({ intentId: id, ...target })))
          .run();
    });
  });
}

export function enqueueDocumentMoveIntent(
  execSql: ExecSql,
  input: PlacementIntentInput,
): Promise<void> {
  return enqueuePlacementIntent(execSql, input, "move");
}

export function enqueueDocumentLinkIntent(
  execSql: ExecSql,
  input: PlacementIntentInput & { sourceContainerId: string },
): Promise<void> {
  return enqueuePlacementIntent(execSql, input, "link");
}

export function enqueueDocumentUnlinkIntent(
  execSql: ExecSql,
  input: PlacementIntentInput & { removedContainerId: string },
): Promise<void> {
  return enqueuePlacementIntent(execSql, input, "unlink");
}
