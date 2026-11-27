import type { DocumentCreatePlan } from "../../../data/documents/shared/types";
import { primeAuthoredDocumentDiscoveryHeads } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { documentContainerProjectionTables } from "../../../data/sqlite/schema/documentProjectionSchema";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";

/**
 * Seeds the discovery head cache with the head a create authored, once the
 * server's acknowledgement was matched to the plan, advanced the document's
 * access-manifest checkpoint, and its writer projection verified. The
 * listing that first names the document then reuses it instead of reading
 * the head back, as it reuses the heads provisioning seeds: it is the same
 * signed head a projection would verify, and the cache serves it only while
 * that checkpoint still matches.
 */
export async function primeCreatedDocumentDiscoveryHead(
  execSql: ExecSql,
  plan: Pick<DocumentCreatePlan, "documentId" | "manifestHash" | "state">,
): Promise<void> {
  await ensureSqlTables(execSql, documentContainerProjectionTables);
  await runSerializedSqlMutation(execSql, (locked) =>
    primeAuthoredDocumentDiscoveryHeads(locked, [
      {
        accessEpoch: plan.state.epoch,
        accessStateHash: plan.manifestHash,
        documentId: plan.documentId,
        linkedContainerIds: plan.state.linkedContainerIds,
        organizationId: plan.state.organizationId,
      },
    ]),
  );
}
