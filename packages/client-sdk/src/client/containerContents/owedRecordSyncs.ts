import type { DomainScope } from "../../data/shared/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { requestRemoteSyncsOfOwedRecords } from "../../stores/documents";
import { listOwedDocumentListingReads } from "../../workflows/documents";

/**
 * Asks each registered store whose own record a listing just owed a read for
 * one pull, once the debts are durable. A debt belongs to a record
 * (`local_id`), and the store registered for a document can hold another
 * record of it: when only a record it displaced owes, a pull of that store
 * would settle nothing. A store that has not loaded its record reads the
 * debt itself when it does.
 */
export async function requestRegisteredDocumentRemoteSyncs(
  domainScope: DomainScope,
  execSql: ExecSql,
  documentIds: ReadonlyArray<string>,
): Promise<void> {
  const listed = new Set(documentIds);
  const owed = await listOwedDocumentListingReads(execSql);
  requestRemoteSyncsOfOwedRecords(
    domainScope,
    owed.filter(({ documentId }) => listed.has(documentId)),
  );
}
