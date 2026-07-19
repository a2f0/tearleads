import { and, eq, or } from "drizzle-orm";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import { sqlContainerSyncWatermarkPersistence } from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import {
  clearDocumentSyncFailure,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
} from "../../data/sqlite/documentPersistence";
import {
  containers,
  documentContainerProjection,
  documentMoveIntents,
  documentProjection,
  documents,
} from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  DOCUMENTS_APP_KIND,
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "../documents";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import type { PendingWriteQueueObjectKind } from "./pendingWritesTypes";

interface DiscardPendingWriteInput {
  readonly documentProjectors: DocumentProjectorRegistryInput;
  readonly execSql: ExecSql;
  readonly localId: string;
  readonly namespace: string | null;
  readonly objectKind: PendingWriteQueueObjectKind;
}

// A container may only be discarded when doing so cannot corrupt the local
// hierarchy or strand other queued work: never a root, never an app-managed
// system container, never a server-synced container (its row is shared state),
// never a parent (children would become orphan roots — the containers table
// has no cascade), and never a container that documents or move intents still
// reference (their queue entries would point at a missing container). A
// missing row is discardable: only stray intent/queue rows remain.
async function canDiscardContainer(
  execSql: ExecSql,
  containerId: string,
): Promise<boolean> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [container] = await db
    .select({
      parentId: containers.parentId,
      serverCreatedAt: containers.serverCreatedAt,
      systemSlot: containers.systemSlot,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  if (!container) {
    return true;
  }
  if (
    container.parentId === null ||
    container.systemSlot !== null ||
    container.serverCreatedAt !== null
  ) {
    return false;
  }
  const children = await db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.parentId, containerId))
    .limit(1);
  if (children.length > 0) {
    return false;
  }
  const linkedDocuments = await db
    .select({ containerId: documentProjection.containerId })
    .from(documentProjection)
    .where(eq(documentProjection.containerId, containerId))
    .limit(1);
  if (linkedDocuments.length > 0) {
    return false;
  }
  const linkRows = await db
    .select({ containerId: documentContainerProjection.containerId })
    .from(documentContainerProjection)
    .where(eq(documentContainerProjection.containerId, containerId))
    .limit(1);
  if (linkRows.length > 0) {
    return false;
  }
  const referencingIntents = await db
    .select({ id: documentMoveIntents.id })
    .from(documentMoveIntents)
    .where(
      or(
        eq(documentMoveIntents.targetContainerId, containerId),
        eq(documentMoveIntents.sourceContainerId, containerId),
      ),
    )
    .limit(1);
  return referencingIntents.length === 0;
}

/**
 * Discard a container's local sync state after the safety guards pass (see
 * `canDiscardContainer`). Exposed separately so the live tree store can run the
 * whole discard on its own write chain — a queued rename or move persisting
 * after a direct deletion would silently re-create the deleted rows.
 */
export async function discardPendingContainerWrite(
  execSql: ExecSql,
  containerId: string,
): Promise<boolean> {
  if (!(await canDiscardContainer(execSql, containerId))) {
    return false;
  }
  await defaultContainerContentsPersistence.deleteContainers(execSql, [
    containerId,
  ]);
  return true;
}

// A synced document that is torn down locally must be re-discovered from the
// server. Discovery is incremental per container, so the linked containers'
// document-lane watermarks are reset first — otherwise the unchanged server
// document is never re-listed and the discard hides it indefinitely.
async function resetDiscoveryForSyncedDocument(
  execSql: ExecSql,
  localId: string,
): Promise<void> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [stored] = await db
    .select({ documentId: documents.documentId })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.localId, localId),
      ),
    )
    .limit(1);
  if (!stored?.documentId) {
    return;
  }
  const links = await db
    .select({ containerId: documentContainerProjection.containerId })
    .from(documentContainerProjection)
    .where(eq(documentContainerProjection.documentId, stored.documentId));
  await sqlContainerSyncWatermarkPersistence.deleteDocumentLaneWatermarksForContainers(
    execSql,
    links.map((link) => link.containerId),
  );
}

/**
 * Drop a write-queue item by discarding the object's local sync state, never by
 * deleting queue rows in isolation. A pending update's ops already live in the
 * local Loro doc with `pendingBaseVersion` advanced past them, so removing only
 * the queue row would orphan those ops forever — the local copy would keep
 * showing edits that can never sync. Instead:
 *
 * - `document`: tear down the whole local copy (document record, projections,
 *   pending updates/attachments, recorded failures) plus any move intent. A
 *   never-synced document is simply gone; a synced one has its linked
 *   containers' discovery watermarks reset first, so it is re-discovered from
 *   the server and re-materializes with server state — i.e. the local edits
 *   are reverted, not stranded.
 * - `container`: delete the local container — only when the
 *   `canDiscardContainer` guards pass — which also drops its create/move
 *   intents, metadata document + pending updates, watermarks, and repairs
 *   member document projections.
 * - `unknown` namespaces: drop the scope's pending updates, stored row, and
 *   recorded failure.
 *
 * Resolves `false` when the item was rejected (a container failing the guard)
 * and nothing was changed. Callers own store/projection notification and
 * serialization: the persisted-document deletion broadcast (and refusing to
 * discard a document whose store is open), and routing container discards
 * through the live tree store's write chain.
 */
export async function discardPendingWrite(
  input: DiscardPendingWriteInput,
): Promise<boolean> {
  const { execSql, localId } = input;

  if (input.objectKind === "container") {
    return discardPendingContainerWrite(execSql, localId);
  }

  if (input.objectKind === "document") {
    await resetDiscoveryForSyncedDocument(execSql, localId);
    await deletePersistedDocument({
      documentProjectors: input.documentProjectors,
      execSql,
      localId,
      persistence: defaultDocumentsPersistence,
    });
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentMoveIntents)
        .where(eq(documentMoveIntents.localId, localId))
        .run();
    });
    return true;
  }

  const scope = { appKind: input.namespace ?? "", localId };
  if (scope.appKind.length === 0) {
    return false;
  }
  await deleteDocumentPendingUpdates(execSql, scope);
  await clearDocumentSyncFailure(execSql, scope);
  await deleteDocumentRecord(execSql, scope);
  return true;
}
