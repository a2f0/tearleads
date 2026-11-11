import { and, eq } from "drizzle-orm";
import { uniqueSortedStrings } from "../../documents/shared/readers";
import {
  documentPlacementIntentTables,
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  LOCAL_INTENT_SUBJECT,
  localIntents,
} from "../../sqlite/schema";
import { documentIntentLinkTargets } from "../../sqlite/schema/documentPlacementIntentSchema";
import {
  documentContainerProjection,
  documentContainerProjectionTables,
} from "../../sqlite/schema/documentProjectionSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
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

async function loadDocumentIntentLinkTargets(
  tx: ClientSQLiteTransactionScope,
  intentId: string,
) {
  return tx
    .select({
      containerId: documentIntentLinkTargets.containerId,
      operation: documentIntentLinkTargets.operation,
    })
    .from(documentIntentLinkTargets)
    .where(eq(documentIntentLinkTargets.intentId, intentId));
}

type LinkTarget = { containerId: string; operation: "link" | "unlink" };

async function loadSurvivingMoveTarget(
  tx: ClientSQLiteTransactionScope,
  previous: typeof localIntents.$inferSelect | undefined,
): Promise<string | null> {
  if (previous?.intentType !== "document.move") return null;
  const [link] = await tx
    .select({ containerId: documentContainerProjection.containerId })
    .from(documentContainerProjection)
    .where(
      and(
        eq(documentContainerProjection.documentId, previous.subjectId),
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

function placementIntentType(
  operation: "move" | "link" | "unlink",
  previous: typeof localIntents.$inferSelect | undefined,
): "document.move" | "document.link" {
  return operation === "move" || previous?.intentType === "document.move"
    ? "document.move"
    : "document.link";
}

function resolveUnlinkPlacement(
  input: PlacementIntentInput,
  previous: typeof localIntents.$inferSelect | undefined,
) {
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

function resolvePlacement(
  input: PlacementIntentInput,
  previous: typeof localIntents.$inferSelect | undefined,
  operation: "move" | "link" | "unlink",
) {
  if (operation === "unlink") {
    return resolveUnlinkPlacement(input, previous);
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

async function ensurePlacementIntentSchema(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, documentPlacementIntentTables);
  await ensureSqlTables(execSql, documentContainerProjectionTables);
}

async function enqueuePlacementIntentRows(
  tx: ClientSQLiteTransactionScope,
  input: PlacementIntentInput,
  operation: "move" | "link" | "unlink",
): Promise<void> {
  const [previous] = await tx
    .select()
    .from(localIntents)
    .where(
      and(
        inLocalIntentLane(LOCAL_INTENT_LANES.documentPlacement),
        eq(localIntents.subjectId, input.documentId),
      ),
    )
    .limit(1);
  const previousTargets = previous?.id
    ? await loadDocumentIntentLinkTargets(tx, previous.id)
    : [];
  const targets = resolveTargets(
    input,
    previousTargets,
    operation,
    operation === "move" ? await loadSurvivingMoveTarget(tx, previous) : null,
  );
  const id = input.id ?? crypto.randomUUID();
  const updatedAt = new Date().toISOString();
  // An additive intent retains the active placement and any pending move.
  // Its targets are separate from the discovery projection: only explicit
  // user additions may be replayed, never stale server-discovered links.
  const next = {
    id,
    lane: LOCAL_INTENT_LANES.documentPlacement,
    subjectId: input.documentId,
    localId: input.localId,
    intentType: placementIntentType(operation, previous),
    lastAttemptedAt: null,
    lastError: null,
    syncStatus: "pending",
    updatedAt,
    ...resolvePlacement(input, previous, operation),
  };
  await tx
    .insert(localIntents)
    .values({ ...next, createdAt: updatedAt })
    .onConflictDoUpdate({
      target: LOCAL_INTENT_SUBJECT,
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
}

/** Only for a document commit side effect: failures must escape its transaction. */
export async function enqueueDocumentPlacementIntentInTransaction(
  transactionExecSql: ExecSql,
  input: PlacementIntentInput,
  operation: "move" | "link" | "unlink",
): Promise<void> {
  await ensurePlacementIntentSchema(transactionExecSql);
  await enqueuePlacementIntentRows(
    getClientSQLitePersistenceRuntime(transactionExecSql).db,
    input,
    operation,
  );
}

async function enqueuePlacementIntent(
  execSql: ExecSql,
  input: PlacementIntentInput,
  operation: "move" | "link" | "unlink",
): Promise<void> {
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensurePlacementIntentSchema(lockedExecSql);
    await getClientSQLitePersistenceRuntime(lockedExecSql).transaction((tx) =>
      enqueuePlacementIntentRows(tx, input, operation),
    );
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
