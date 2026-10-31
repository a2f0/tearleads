import { and, desc, eq, inArray, notInArray, type SQL } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../../documents/documentConstants";
import type { StoredDocumentKind } from "../../../documents/documentKinds";
import { HIDDEN_DOCUMENT_SUMMARY_KINDS } from "../../../documents/documentSummary";
import {
  documentProjection,
  documentProjectionText,
  documents,
} from "../../../sqlite/schema";
import { sqliteRowsPerStatement } from "../../../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../../sqlite/sqlitePersistenceRuntime";
import {
  documentRecordSelection,
  findLocalIdByDocumentId,
  loadDocumentRecord,
  mapSelectedDocumentRecord,
} from "../records";
import type { DocumentsPersistence, StoredDocumentRecord } from "../types";
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

/** The projection columns a stored record was loaded with, if any. */
export interface StoredDocumentProjectionState {
  documentKind: StoredDocumentKind;
  text: string | null;
  title: string;
  updatedAt: string;
}

const storedDocumentStateSelection = {
  ...documentRecordSelection,
  projectionContainerId: documentProjection.containerId,
  projectionDocumentKind: documentProjection.documentKind,
  projectionText: documentProjectionText.text,
  projectionTitle: documentProjection.title,
  projectionUpdatedAt: documentProjection.updatedAt,
};

export interface StoredDocumentState {
  projection: StoredDocumentProjectionState | null;
  record: StoredDocumentRecord;
}

function storedDocumentStateQuery(
  execSql: Parameters<DocumentsPersistence["loadDocument"]>[0],
  localIds: SQL | undefined,
) {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  return db
    .select(storedDocumentStateSelection)
    .from(documents)
    .leftJoin(
      documentProjection,
      eq(documentProjection.localId, documents.localId),
    )
    .leftJoin(
      documentProjectionText,
      eq(documentProjectionText.localId, documentProjection.localId),
    )
    .where(and(eq(documents.appKind, DOCUMENTS_APP_KIND), localIds));
}

function mapStoredDocumentState(
  row: Awaited<ReturnType<typeof storedDocumentStateQuery>>[number],
): StoredDocumentState {
  const {
    projectionContainerId,
    projectionDocumentKind,
    projectionText,
    projectionTitle,
    projectionUpdatedAt,
    ...recordRow
  } = row;
  // Projection columns are NOT NULL, so they are null exactly when the
  // projection row is absent.
  const projectionRow =
    projectionDocumentKind !== null &&
    projectionTitle !== null &&
    projectionUpdatedAt !== null
      ? {
          containerId: projectionContainerId,
          documentKind: projectionDocumentKind,
          text: projectionText,
          title: projectionTitle,
        }
      : undefined;
  return {
    projection:
      projectionRow && projectionUpdatedAt !== null
        ? { ...projectionRow, updatedAt: projectionUpdatedAt }
        : null,
    record: {
      ...mapSelectedDocumentRecord(recordRow),
      containerId: getProjectionContainerId(projectionRow),
      documentKind: getProjectionDocumentKind(projectionRow),
      text: getProjectionText(projectionRow),
      title: getProjectionTitle(projectionRow),
    },
  };
}

/**
 * The canonical record and its projection from ONE joined statement, so the
 * pair comes from one snapshot and a save inside the same transaction can
 * reuse the projection instead of reading it again.
 */
export async function loadStoredDocumentState(
  execSql: Parameters<DocumentsPersistence["loadDocument"]>[0],
  localId: string,
): Promise<StoredDocumentState | null> {
  const [row] = await storedDocumentStateQuery(
    execSql,
    eq(documents.localId, localId),
  ).limit(1);
  return row ? mapStoredDocumentState(row) : null;
}

/** `loadStoredDocumentState` for many local ids, one joined read per chunk. */
export async function loadStoredDocumentStates(
  execSql: Parameters<DocumentsPersistence["loadDocument"]>[0],
  localIds: ReadonlyArray<string>,
): Promise<Map<string, StoredDocumentState>> {
  const states = new Map<string, StoredDocumentState>();
  const unique = Array.from(new Set(localIds));
  // One bind for the app kind; the rest carry local ids.
  const chunkSize = sqliteRowsPerStatement(1, 1);
  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    const rows = await storedDocumentStateQuery(
      execSql,
      inArray(documents.localId, unique.slice(offset, offset + chunkSize)),
    );
    for (const row of rows) states.set(row.id, mapStoredDocumentState(row));
  }
  return states;
}

type DocumentRowQueryPersistence = Pick<
  DocumentsPersistence,
  | "listDocuments"
  | "findDocumentLocalIdsByContainerId"
  | "findLocalIdByDocumentId"
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
  findLocalIdByDocumentId: (execSql, documentId) =>
    findLocalIdByDocumentId(execSql, DOCUMENTS_APP_KIND, documentId),
  async hasDocument(execSql, localId) {
    return hasDocumentRow(execSql, localId);
  },
  async documentIdentityMatches(
    execSql,
    localId,
    expectedDocumentId,
    expectedRecoveryGeneration,
  ) {
    const record = await loadDocumentRecord(execSql, getDocumentScope(localId));
    return (
      record?.documentId === expectedDocumentId &&
      (record.recoveryGeneration ?? 0) === expectedRecoveryGeneration
    );
  },
  async loadDocument(execSql, localId) {
    return (await loadStoredDocumentState(execSql, localId))?.record ?? null;
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
