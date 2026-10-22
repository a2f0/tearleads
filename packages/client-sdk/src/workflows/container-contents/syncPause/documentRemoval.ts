import { hasQueuedLocalDocumentUpdates } from "../../../data/persistence/container-contents/exclusiveDocumentPlacements";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  defaultDocumentsPersistence,
  deletePersistedDocument,
} from "../../documents";
import type { ContainerContentsWorkflowRuntimeInfra } from "../runtime";

export { listDocumentLocalIdsPlacedOnlyIn } from "../../../data/persistence/container-contents/exclusiveDocumentPlacements";

/**
 * Deletes a local document unless it has writes queued for upload or its
 * record changed since it was read. The queue check and the delete hold one
 * SQLite mutation lock, so a write cannot land between them.
 */
export async function deleteDocumentUnlessQueued(input: {
  readonly documentProjectors: ContainerContentsWorkflowRuntimeInfra["documentProjectors"];
  readonly execSql: ExecSql;
  readonly localId: string;
}): Promise<boolean> {
  return runSerializedSqlMutation(input.execSql, async (lockedExecSql) => {
    if (await hasQueuedLocalDocumentUpdates(lockedExecSql, input.localId)) {
      return false;
    }
    const expectedRecord = await defaultDocumentsPersistence.loadDocument(
      lockedExecSql,
      input.localId,
    );
    if (!expectedRecord) return true;
    return deletePersistedDocument({
      documentProjectors: input.documentProjectors,
      execSql: lockedExecSql,
      expectedRecord,
      localId: input.localId,
      persistence: defaultDocumentsPersistence,
    });
  });
}
