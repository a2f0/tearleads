import type { DocumentCreatePlan } from "../../../data/documents/shared/types";
import {
  type AuthoredDiscoveryHead,
  writeAuthoredDocumentDiscoveryHeads,
} from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { readDocumentDiscoveryEvictionMark } from "../../../data/persistence/documents/documentDiscoveryReset";
import { documentContainerProjectionTables } from "../../../data/sqlite/schema/documentProjectionSchema";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../../data/sqlite/sqlSchema";
import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";
import { reportQuietly } from "../sync/reportQuietly";

type LogError = WorkflowRuntimeUtilInput["logError"] | undefined;

const NOT_CACHED = "Documents: a created document's head was not cached";

/** The head a create authored, as the discovery head cache keys it. */
export function createdDocumentHead(
  plan: Pick<DocumentCreatePlan, "documentId" | "manifestHash" | "state">,
): AuthoredDiscoveryHead {
  return {
    accessEpoch: plan.state.epoch,
    accessStateHash: plan.manifestHash,
    documentId: plan.documentId,
    linkedContainerIds: plan.state.linkedContainerIds,
    organizationId: plan.state.organizationId,
  };
}

/**
 * Reads the cache's eviction mark before a create's acknowledgement is
 * applied. A remote reset or an access change evicts the cache and raises
 * the mark, so a seed that finds it raised under the write lock knows its
 * head may be one they evicted. Null when it cannot be read: the create then
 * seeds nothing, and the first listing reads the head as before.
 */
export async function readCreatedDocumentHeadFence(
  execSql: ExecSql,
  logError: LogError,
): Promise<number | null> {
  try {
    await ensureSqlTables(execSql, documentContainerProjectionTables);
    return await readDocumentDiscoveryEvictionMark(
      getClientSQLitePersistenceRuntime(execSql).db,
    );
  } catch (error) {
    reportQuietly(logError, NOT_CACHED, error);
    return null;
  }
}

/**
 * Seeds the discovery head cache with the head a create authored, once the
 * server's acknowledgement was matched to the plan, advanced the document's
 * access-manifest checkpoint, and its writer projection verified. The
 * listing that first names the document then reuses it instead of reading
 * the head back, as it reuses the heads provisioning seeds: it is the same
 * signed head a projection would verify, and the cache serves it only while
 * that checkpoint still matches.
 *
 * The seed only saves that read, so it never fails a create the server
 * already committed: a failure, such as another tab's transaction refusing
 * the write, is logged and leaves the cache empty. It writes in one
 * transaction that finds the eviction mark unchanged since `fence` was read
 * and commits only while the create's runtime is still current.
 */
export async function primeCreatedDocumentDiscoveryHead(input: {
  readonly execSql: ExecSql;
  readonly fence: number | null;
  readonly head: AuthoredDiscoveryHead;
  readonly logError?: LogError;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<void> {
  const { fence, stillCurrent } = input;
  if (fence === null || stillCurrent?.() === false) return;
  try {
    await getClientSQLitePersistenceRuntime(input.execSql).guardedTransaction(
      async (tx) => {
        if ((await readDocumentDiscoveryEvictionMark(tx)) !== fence) return;
        await writeAuthoredDocumentDiscoveryHeads(tx, [input.head]);
      },
      () => stillCurrent?.() !== false,
    );
  } catch (error) {
    reportQuietly(input.logError, NOT_CACHED, error);
  }
}
