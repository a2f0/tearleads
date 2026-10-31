import { and, eq, lte } from "drizzle-orm";
import {
  DEFAULT_DOCUMENT_KIND,
  DOCUMENTS_APP_KIND,
} from "../../../documents/documentConstants";
import {
  deriveStoredDocumentTitle,
  type StoredDocumentKind,
} from "../../../documents/documentKinds";
import { serializeDocumentSyncPullContinuation } from "../../../documents/shared/sync/pullContinuation";
import { normalizeEffectiveAccessLevel } from "../../../keying/accessLevel";
import {
  documentProjection,
  documentProjectionText,
  documents,
} from "../../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import type { DocumentScope } from "../records";
import { CLEARED_DOCUMENT_SYNC_FAILURE } from "../records/documentSyncFailurePersistence";
import type { StoredDocumentRecord } from "../types";
import {
  getProjectionDocumentKind,
  getProjectionText,
  getProjectionTitle,
  getProjectionUpdatedAt,
} from "./documentProjectionRows";

export function getDocumentScope(localId: string): DocumentScope {
  return {
    appKind: DOCUMENTS_APP_KIND,
    localId,
  };
}

export async function hasDocumentRow(
  execSql: ExecSql,
  localId: string,
): Promise<boolean> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select({ localId: documents.localId })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.localId, localId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function toDocumentRecordRow(input: {
  document: StoredDocumentRecord;
  updatedAt: string;
}) {
  const { document, updatedAt } = input;
  return {
    appKind: DOCUMENTS_APP_KIND,
    localId: document.id,
    documentId: document.documentId,
    recoveryGeneration: document.recoveryGeneration ?? 0,
    recoveryDocumentId: document.documentId
      ? null
      : (document.recoveryDocumentId ?? null),
    snapshotEndVersion: document.snapshotEndVersion,
    accessEpoch: document.accessEpoch,
    accessStateHash: document.accessStateHash ?? null,
    effectiveAccessLevel: normalizeEffectiveAccessLevel(
      document.effectiveAccessLevel,
    ),
    lastCommitLsn: document.lastCommitLsn ?? null,
    documentManifestBundle: document.documentManifestBundle ?? null,
    contentKeyBundle: document.contentKeyBundle ?? null,
    documentKekTargets: document.documentKekTargets ?? null,
    // Only touch the outgoing-delta marker when the caller manages it. Callers
    // that leave it undefined (e.g. discovery upserts, registration bootstrap)
    // must not clobber a marker a device-first deferRemoteSync write persisted.
    ...(document.pendingBaseVersion === undefined
      ? {}
      : { pendingBaseVersion: document.pendingBaseVersion }),
    ...(document.pullContinuation === undefined
      ? {}
      : {
          pullContinuation: serializeDocumentSyncPullContinuation(
            document.pullContinuation,
          ),
        }),
    updatedAt,
  };
}

async function saveDocumentProjectionRows(input: {
  document: StoredDocumentRecord;
  tx: ClientSQLiteTransactionScope;
  updatedAt: string;
}): Promise<void> {
  const { document, tx, updatedAt } = input;
  const projectionRow = {
    localId: document.id,
    documentId: document.documentId,
    containerId: document.containerId,
    documentKind: document.documentKind ?? DEFAULT_DOCUMENT_KIND,
    title: document.title ?? deriveStoredDocumentTitle(document.text),
    updatedAt,
  };
  await tx
    .insert(documentProjection)
    .values(projectionRow)
    .onConflictDoUpdate({
      target: documentProjection.localId,
      set: projectionRow,
    })
    .run();

  const projectionTextRow = {
    localId: document.id,
    text: document.text,
  };
  await tx
    .insert(documentProjectionText)
    .values(projectionTextRow)
    .onConflictDoUpdate({
      target: documentProjectionText.localId,
      set: projectionTextRow,
    })
    .run();
}

export async function createDocumentRowsIfAbsent(input: {
  document: StoredDocumentRecord;
  tx: ClientSQLiteTransactionScope;
  updatedAt: string;
}): Promise<boolean> {
  const { document, tx, updatedAt } = input;
  const documentRow = toDocumentRecordRow({ document, updatedAt });
  const inserted = await tx
    .insert(documents)
    .values(documentRow)
    .onConflictDoNothing({
      target: [documents.appKind, documents.localId],
    })
    .returning({ localId: documents.localId });
  if (inserted.length === 0) {
    return false;
  }

  await saveDocumentProjectionRows(input);
  return true;
}

export async function saveDocumentRows(input: {
  /** Clears the recorded sync failure in the same guarded upsert. */
  clearSyncFailure?: boolean;
  document: StoredDocumentRecord;
  tx: ClientSQLiteTransactionScope;
  updatedAt: string;
}): Promise<boolean> {
  const { document, tx, updatedAt } = input;
  const documentRow = {
    ...toDocumentRecordRow({ document, updatedAt }),
    ...(input.clearSyncFailure ? CLEARED_DOCUMENT_SYNC_FAILURE : {}),
  };
  // The recovery-generation fence rides on the upsert: a stored row from a
  // newer recovery generation is left untouched and returns no row, so a
  // stale writer skips the projection writes without a separate read.
  const saved = await tx
    .insert(documents)
    .values(documentRow)
    .onConflictDoUpdate({
      target: [documents.appKind, documents.localId],
      set: documentRow,
      setWhere: lte(
        documents.recoveryGeneration,
        documentRow.recoveryGeneration,
      ),
    })
    .returning({ localId: documents.localId });
  if (saved.length === 0) {
    return false;
  }
  await saveDocumentProjectionRows(input);
  return true;
}

function didStoredDocumentContentChange(
  existing: Pick<
    StoredDocumentRecord,
    "documentKind" | "snapshotEndVersion" | "text" | "title"
  > | null,
  next: Pick<
    StoredDocumentRecord,
    "documentKind" | "snapshotEndVersion" | "text" | "title"
  >,
): boolean {
  return (
    existing === null ||
    existing.documentKind !== (next.documentKind ?? DEFAULT_DOCUMENT_KIND) ||
    existing.snapshotEndVersion !== next.snapshotEndVersion ||
    existing.text !== next.text ||
    existing.title !== (next.title ?? deriveStoredDocumentTitle(next.text))
  );
}

export async function resolveDocumentSaveTimestamp(input: {
  document: StoredDocumentRecord;
  options?: { updatedAt?: string } | undefined;
  tx: ClientSQLiteTransactionScope;
}): Promise<string> {
  const { document, options, tx } = input;
  if (options?.updatedAt) {
    return options.updatedAt;
  }

  // One read for the stored row and its projection; the projection columns
  // are not nullable, so they are null exactly when the projection is absent.
  const [existing] = await tx
    .select({
      snapshotEndVersion: documents.snapshotEndVersion,
      documentKind: documentProjection.documentKind,
      text: documentProjectionText.text,
      title: documentProjection.title,
      updatedAt: documentProjection.updatedAt,
    })
    .from(documents)
    .leftJoin(
      documentProjection,
      eq(documentProjection.localId, documents.localId),
    )
    .leftJoin(
      documentProjectionText,
      eq(documentProjectionText.localId, documentProjection.localId),
    )
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.localId, document.id),
      ),
    )
    .limit(1);
  return documentSaveTimestampFrom(
    existing
      ? {
          projection:
            existing.documentKind != null &&
            existing.title != null &&
            existing.updatedAt != null
              ? {
                  documentKind: existing.documentKind,
                  text: existing.text,
                  title: existing.title,
                  updatedAt: existing.updatedAt,
                }
              : null,
          snapshotEndVersion: existing.snapshotEndVersion,
        }
      : null,
    document,
  );
}

/**
 * The save timestamp from rows already read in the saving transaction: the
 * stored time survives only when the content is unchanged.
 */
export function documentSaveTimestampFrom(
  existing: {
    projection: {
      documentKind: StoredDocumentKind;
      text: string | null;
      title: string;
      updatedAt: string;
    } | null;
    snapshotEndVersion: string;
  } | null,
  document: StoredDocumentRecord,
): string {
  const existingProjection = existing?.projection ?? undefined;
  const now = new Date().toISOString();
  return didStoredDocumentContentChange(
    existing
      ? {
          documentKind: getProjectionDocumentKind(existingProjection),
          snapshotEndVersion: existing.snapshotEndVersion,
          text: getProjectionText(existingProjection),
          title: getProjectionTitle(existingProjection),
        }
      : null,
    document,
  )
    ? now
    : getProjectionUpdatedAt(existingProjection) || now;
}
