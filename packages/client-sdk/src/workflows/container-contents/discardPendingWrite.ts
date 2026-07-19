import { eq } from "drizzle-orm";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import {
  clearDocumentSyncFailure,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
} from "../../data/sqlite/documentPersistence";
import { containers, documentMoveIntents } from "../../data/sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
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
// hierarchy or reach beyond local state: never a root, never an app-managed
// system container, never a parent (children would become orphan roots — the
// containers table has no cascade), and never a server-synced container (its
// row is shared state; only its never-synced local intents are safe to drop
// this way). A missing row is discardable: only stray intent/queue rows remain.
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
  return children.length === 0;
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
 *   never-synced document is simply gone; a synced one is re-discovered from
 *   the server and re-materializes with server state — i.e. the local edits are
 *   reverted, not stranded.
 * - `container`: delete the local container — only when it is a never-synced,
 *   childless, non-system, non-root container (see `canDiscardContainer`) —
 *   which also drops its create/move intents, metadata document + pending
 *   updates, watermarks, and repairs member document projections.
 * - `unknown` namespaces: drop the scope's pending updates, stored row, and
 *   recorded failure.
 *
 * Resolves `false` when the item was rejected (a container failing the guard)
 * and nothing was changed. Callers own store/projection notification (e.g.
 * emitting the persisted document deletion so an open store tears down instead
 * of resurrecting the record on its next persist, and evicting a discarded
 * container from the live tree store).
 */
export async function discardPendingWrite(
  input: DiscardPendingWriteInput,
): Promise<boolean> {
  const { execSql, localId } = input;

  if (input.objectKind === "container") {
    if (!(await canDiscardContainer(execSql, localId))) {
      return false;
    }
    await defaultContainerContentsPersistence.deleteContainers(execSql, [
      localId,
    ]);
    return true;
  }

  if (input.objectKind === "document") {
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
