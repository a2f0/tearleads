import { eq } from "drizzle-orm";
import type { DocumentProjectorRegistryInput } from "../../data/documents/documentKinds";
import {
  clearDocumentSyncFailure,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
} from "../../data/sqlite/documentPersistence";
import { documentMoveIntents } from "../../data/sqlite/schema";
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
 * - `container`: delete the local container, which also drops its create/move
 *   intents, metadata document + pending updates, watermarks, and repairs
 *   member document projections. A server-side container re-hydrates on the
 *   next structural pass.
 * - `unknown` namespaces: drop the scope's pending updates, stored row, and
 *   recorded failure.
 *
 * Callers own store/projection notification (e.g. emitting the persisted
 * document deletion so an open store tears down instead of resurrecting the
 * record on its next persist).
 */
export async function discardPendingWrite(
  input: DiscardPendingWriteInput,
): Promise<void> {
  const { execSql, localId } = input;

  if (input.objectKind === "container") {
    await defaultContainerContentsPersistence.deleteContainers(execSql, [
      localId,
    ]);
    return;
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
    return;
  }

  const scope = { appKind: input.namespace ?? "", localId };
  if (scope.appKind.length === 0) {
    return;
  }
  await deleteDocumentPendingUpdates(execSql, scope);
  await clearDocumentSyncFailure(execSql, scope);
  await deleteDocumentRecord(execSql, scope);
}
