import { desc, eq, notInArray } from "drizzle-orm";
import { HIDDEN_DOCUMENT_SUMMARY_KINDS } from "../../../documents/documentSummary";
import { loadDocumentRecord } from "../../../sqlite/documentPersistence";
import {
  documentProjection,
  documentProjectionText,
  documents,
} from "../../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentsPersistence } from "../types";
import {
  documentSummaryJoin,
  documentSummarySelection,
  getProjectionContainerId,
  getProjectionDocumentKind,
  getProjectionText,
  getProjectionTitle,
  mapDocumentSummary,
} from "./documentProjectionRows";
import { getDocumentScope, hasDocumentRow } from "./documentRows";

type DocumentRowQueryPersistence = Pick<
  DocumentsPersistence,
  | "listDocuments"
  | "findDocumentLocalIdsByContainerId"
  | "hasDocument"
  | "documentIdentityMatches"
  | "loadDocument"
  | "loadDocumentContainer"
>;

export const documentRowQueryPersistence: DocumentRowQueryPersistence = {
  async listDocuments(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select(documentSummarySelection)
      .from(documentProjection)
      .leftJoin(documents, documentSummaryJoin)
      .where(
        notInArray(documentProjection.documentKind, [
          ...HIDDEN_DOCUMENT_SUMMARY_KINDS,
        ]),
      )
      .orderBy(
        desc(documentProjection.updatedAt),
        desc(documentProjection.localId),
      );

    return rows.map(mapDocumentSummary);
  },
  async findDocumentLocalIdsByContainerId(execSql, containerId) {
    // Unlike `listDocumentsByContainerIdsOrDocumentIds`, this deliberately does
    // NOT drop `HIDDEN_DOCUMENT_SUMMARY_KINDS` — it exists to reach the hidden
    // `organization_profile` document by the container it is linked to, which is
    // how a *foreign* org's display name is found on a member who synced the doc
    // under its server documentId rather than the provisioner-only local alias.
    // `documentProjection` is written and deleted in lockstep with the
    // `documents` rows (all DOCUMENTS_APP_KIND), so filtering by containerId
    // alone is sufficient — no join to `documents` is needed to select localId.
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({ localId: documentProjection.localId })
      .from(documentProjection)
      .where(eq(documentProjection.containerId, containerId))
      .orderBy(
        desc(documentProjection.updatedAt),
        desc(documentProjection.localId),
      );
    return rows
      .map((row) => row.localId)
      .filter((localId): localId is string => localId !== null);
  },
  async hasDocument(execSql, localId) {
    return hasDocumentRow(execSql, localId);
  },
  async documentIdentityMatches(execSql, localId, expectedDocumentId) {
    const record = await loadDocumentRecord(execSql, getDocumentScope(localId));
    return record?.documentId === expectedDocumentId;
  },
  async loadDocument(execSql, localId) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const [documentRecord, projectionRows] = await Promise.all([
      loadDocumentRecord(execSql, getDocumentScope(localId)),
      db
        .select({
          documentKind: documentProjection.documentKind,
          text: documentProjectionText.text,
          title: documentProjection.title,
          containerId: documentProjection.containerId,
        })
        .from(documentProjection)
        .leftJoin(
          documentProjectionText,
          eq(documentProjectionText.localId, documentProjection.localId),
        )
        .where(eq(documentProjection.localId, localId))
        .limit(1),
    ]);

    if (!documentRecord) {
      return null;
    }

    return {
      ...documentRecord,
      containerId: getProjectionContainerId(projectionRows[0]),
      documentKind: getProjectionDocumentKind(projectionRows[0]),
      text: getProjectionText(projectionRows[0]),
      title: getProjectionTitle(projectionRows[0]),
    };
  },
  async loadDocumentContainer(execSql, localId) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    // Select the row itself, not just its container, so an existing row with a
    // null container is reported as `{ containerId: null }` while a missing row
    // is reported as `undefined` — the caller relies on that distinction to know
    // whether the projection has authoritative placement to defer to.
    const projectionRows = await db
      .select({ containerId: documentProjection.containerId })
      .from(documentProjection)
      .where(eq(documentProjection.localId, localId))
      .limit(1);
    const projectionRow = projectionRows[0];
    if (!projectionRow) {
      return undefined;
    }

    return { containerId: projectionRow.containerId };
  },
};
