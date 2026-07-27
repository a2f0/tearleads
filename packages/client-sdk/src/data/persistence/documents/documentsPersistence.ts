import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../documentSummary";
import {
  DEFAULT_DOCUMENT_ACCESS_EPOCH,
  DEFAULT_DOCUMENT_KIND,
} from "../../documents/documentConstants";
import {
  appendDocumentHistoryUpdates,
  deleteDocumentHistory,
  listDocumentHistoryTailEntries,
  loadDocumentHistoryRestoreState,
  readDocumentHistoryTailSize,
  replaceDocumentHistoryCheckpoint,
} from "../../sqlite/documentHistoryPersistence";
import {
  clearDocumentSyncFailure,
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
  enqueueDocumentPendingUpdateWithHistory,
  ensureDocumentProjectionTables,
  ensureDocumentTables,
  findLocalIdByDocumentId,
  listDocumentPendingUpdates,
  loadDocumentRecord,
  rekeyDocumentPendingUpdate,
} from "../../sqlite/documentPersistence";
import {
  documentAttachmentBlobProjection,
  documentContainerProjection,
  documentContainerProjectionTables,
  documentMoveIntents,
  documentMoveIntentTables,
  documentPendingAttachments,
  documentPendingUpdates,
  documentProjection,
  documentProjectionText,
  documents,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runOncePerConnection,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import {
  buildPendingAttachmentRow,
  mapLocalAttachmentRecord,
  mapPendingAttachmentRecord,
} from "./internal/attachmentRows";
import { DOCUMENTS_APP_KIND } from "./internal/constants";
import { applyContainerDocumentTombstonesWithExec } from "./internal/containerDocumentTombstones";
import {
  documentSummaryJoin,
  documentSummarySelection,
  getProjectionContainerId,
  getProjectionDocumentKind,
  getProjectionText,
  getProjectionTitle,
  getProjectionUpdatedAt,
  mapDocumentSummary,
  toDocumentSummary,
} from "./internal/documentProjectionRows";
import {
  getDocumentScope,
  resolveDocumentSaveTimestamp,
  saveDocumentRows,
} from "./internal/documentRows";
import {
  resolvePersistedAccessStateHash,
  resolvePersistedDocumentRuntimeState,
} from "./internal/documentRuntimeState";
import { mapPendingCreateLocalIds } from "./internal/pendingCreateAdoption";
import type {
  ContainerDocumentTombstoneInput,
  DiscardDocumentToShellResult,
  DocumentSummaryList,
  DocumentSummarySort,
  DocumentsPersistence,
  ListDocumentSummariesInput,
  RelinkPersistedDocumentInput,
  StoredDocumentRecord,
} from "./types";

const HIDDEN_DOCUMENT_SUMMARY_KINDS = ["organization_profile"];
const DISCOVERED_DOCUMENT_PLACEHOLDER_TITLE = "Syncing document...";
const DEFAULT_DOCUMENT_SUMMARY_SORT: DocumentSummarySort = {
  direction: "desc",
  key: "updated",
};

export { DOCUMENTS_APP_KIND } from "./internal/constants";
export type {
  ContainerDocumentTombstoneInput,
  DiscardDocumentToShellResult,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingAttachmentUploadIdentity,
  PendingUpdateInsert,
  PendingUpdateRecord,
  RelinkPersistedDocumentInput,
  StoredDocumentRecord,
} from "./types";

function normalizeDocumentSummaryWindowValue(
  value: number | undefined,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeDocumentSummarySort(
  sort: DocumentSummarySort | undefined,
): DocumentSummarySort {
  if (
    !sort ||
    (sort.direction !== "asc" && sort.direction !== "desc") ||
    !["kind", "title", "updated"].includes(sort.key)
  ) {
    return DEFAULT_DOCUMENT_SUMMARY_SORT;
  }

  return sort;
}

function getDocumentSummaryFilters(
  input: ListDocumentSummariesInput,
): SQL | undefined {
  const conditions: SQL[] = [
    notInArray(documentProjection.documentKind, HIDDEN_DOCUMENT_SUMMARY_KINDS),
  ];
  if (input.documentKind) {
    conditions.push(eq(documentProjection.documentKind, input.documentKind));
  }

  return and(...conditions);
}

function getDocumentSummaryOrderBy(
  sort: DocumentSummarySort | undefined,
): SQL[] {
  const normalizedSort = normalizeDocumentSummarySort(sort);
  const order =
    normalizedSort.direction === "asc"
      ? {
          column: asc,
        }
      : {
          column: desc,
        };

  switch (normalizedSort.key) {
    case "kind":
      return [
        order.column(documentProjection.documentKind),
        order.column(documentProjection.localId),
      ];
    case "title":
      return [
        order.column(sql`${documentProjection.title} COLLATE NOCASE`),
        order.column(documentProjection.localId),
      ];
    case "updated":
      return [
        order.column(documentProjection.updatedAt),
        order.column(documentProjection.localId),
      ];
  }
}

async function listDocumentSummaries(
  execSql: ExecSql,
  input: ListDocumentSummariesInput = {},
): Promise<DocumentSummaryList> {
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const filters = getDocumentSummaryFilters(input);
  const normalizedOffset = normalizeDocumentSummaryWindowValue(input.offset);
  const normalizedLimit =
    input.limit === undefined
      ? null
      : normalizeDocumentSummaryWindowValue(input.limit);
  const totalCountRows = await db
    .select({ totalCount: count() })
    .from(documentProjection)
    .where(filters);
  const rowQuery = db
    .select(documentSummarySelection)
    .from(documentProjection)
    .leftJoin(documents, documentSummaryJoin)
    .where(filters)
    .orderBy(...getDocumentSummaryOrderBy(input.sort));
  const rows =
    normalizedLimit === null
      ? normalizedOffset === 0
        ? await rowQuery
        : await rowQuery.limit(-1).offset(normalizedOffset)
      : await rowQuery.limit(normalizedLimit).offset(normalizedOffset);

  return {
    rows: rows.map(mapDocumentSummary),
    totalCount: totalCountRows[0]?.totalCount ?? 0,
  };
}

async function upsertDiscoveredDocumentWithExec(
  execSql: ExecSql,
  input: DiscoveredDocumentInput,
  pendingCreates: ReadonlyMap<string, string>,
): Promise<DocumentSummary> {
  const existingLocalId = await findLocalIdByDocumentId(
    execSql,
    DOCUMENTS_APP_KIND,
    input.documentId,
  );
  const localId =
    existingLocalId ?? pendingCreates.get(input.documentId) ?? input.documentId;
  const existingDocument = await sqlDocumentsPersistence.loadDocument(
    execSql,
    localId,
  );
  const nextAccessEpoch = Math.max(
    existingDocument?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH,
    input.accessEpoch,
  );
  const nextContainerId =
    existingDocument?.containerId &&
    input.linkedContainerIds.includes(existingDocument.containerId)
      ? existingDocument.containerId
      : (input.linkedContainerIds.find(
          (linkedContainerId) => linkedContainerId === input.containerId,
        ) ??
        input.linkedContainerIds[0] ??
        input.containerId);

  const nextDocument: StoredDocumentRecord = {
    id: localId,
    containerId: nextContainerId,
    documentId: input.documentId,
    documentKind: existingDocument?.documentKind ?? DEFAULT_DOCUMENT_KIND,
    text: existingDocument?.text ?? "",
    title: existingDocument?.title ?? DISCOVERED_DOCUMENT_PLACEHOLDER_TITLE,
    loroSnapshot: existingDocument?.loroSnapshot ?? "",
    accessEpoch: nextAccessEpoch,
    accessStateHash: resolvePersistedAccessStateHash(existingDocument, {
      accessEpoch: nextAccessEpoch,
      accessStateHash: input.accessStateHash,
      documentId: input.documentId,
    }),
    effectiveAccessLevel:
      input.effectiveAccessLevel ??
      existingDocument?.effectiveAccessLevel ??
      null,
    ...resolvePersistedDocumentRuntimeState(existingDocument, {
      accessEpoch: nextAccessEpoch,
      documentId: input.documentId,
    }),
  };

  const saveOptions =
    existingDocument === null || existingDocument === undefined
      ? { updatedAt: input.createdAt }
      : undefined;
  const updatedAt = await sqlDocumentsPersistence.saveDocument(
    execSql,
    nextDocument,
    saveOptions,
  );

  return toDocumentSummary(nextDocument, updatedAt);
}

async function relinkPersistedDocumentWithExec(
  execSql: ExecSql,
  input: RelinkPersistedDocumentInput,
): Promise<DocumentSummary | null> {
  const existingDocument = await sqlDocumentsPersistence.loadDocument(
    execSql,
    input.localId,
  );
  if (!existingDocument) {
    return null;
  }

  const nextAccessEpoch = Math.max(
    existingDocument.accessEpoch,
    input.accessEpoch,
  );
  const nextDocument: StoredDocumentRecord = {
    ...existingDocument,
    accessEpoch: nextAccessEpoch,
    accessStateHash: resolvePersistedAccessStateHash(existingDocument, {
      accessEpoch: nextAccessEpoch,
      accessStateHash: input.accessStateHash,
      documentId: input.documentId,
    }),
    containerId: input.containerId,
    documentId: input.documentId,
    ...resolvePersistedDocumentRuntimeState(existingDocument, {
      accessEpoch: nextAccessEpoch,
      documentId: input.documentId,
    }),
  };

  await sqlDocumentsPersistence.saveDocument(execSql, nextDocument);

  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const updatedAtRows = await db
    .select({ updatedAt: documentProjection.updatedAt })
    .from(documentProjection)
    .where(eq(documentProjection.localId, input.localId))
    .limit(1);

  return toDocumentSummary(
    nextDocument,
    getProjectionUpdatedAt(updatedAtRows[0]),
  );
}

export async function upsertDiscoveredDocuments(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
): Promise<DocumentSummary[]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlDocumentsPersistence.ensureSchema(lockedExecSql);
    const pendingCreates = await mapPendingCreateLocalIds(lockedExecSql);
    const nextSummaries: DocumentSummary[] = [];

    for (const input of inputs) {
      nextSummaries.push(
        await upsertDiscoveredDocumentWithExec(
          lockedExecSql,
          input,
          pendingCreates,
        ),
      );
    }

    return nextSummaries;
  });
}

export async function applyContainerDocumentTombstones(
  execSql: ExecSql,
  tombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
): Promise<DocumentSummary[]> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await sqlStoredDocumentsPersistence.ensureSchema(lockedExecSql);
    return applyContainerDocumentTombstonesWithExec(lockedExecSql, tombstones);
  });
}

export async function listDocumentsByContainerIds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<DocumentSummary[]> {
  const uniqueContainerIds = [...new Set(containerIds)];

  if (uniqueContainerIds.length === 0) {
    return [];
  }

  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select(documentSummarySelection)
    .from(documentProjection)
    .leftJoin(documents, documentSummaryJoin)
    .where(
      and(
        inArray(documentProjection.containerId, uniqueContainerIds),
        notInArray(
          documentProjection.documentKind,
          HIDDEN_DOCUMENT_SUMMARY_KINDS,
        ),
      ),
    )
    .orderBy(
      desc(documentProjection.updatedAt),
      desc(documentProjection.localId),
    );

  return rows.map(mapDocumentSummary);
}

async function listDocumentsByContainerIdsOrDocumentIds(
  execSql: ExecSql,
  input: {
    containerIds: ReadonlyArray<string>;
    documentIds: ReadonlyArray<string>;
  },
): Promise<DocumentSummary[]> {
  const uniqueContainerIds = Array.from(new Set(input.containerIds));
  const uniqueDocumentIds = Array.from(new Set(input.documentIds));
  if (uniqueContainerIds.length === 0 && uniqueDocumentIds.length === 0) {
    return [];
  }

  const filters: SQL[] = [];
  if (uniqueContainerIds.length > 0) {
    filters.push(inArray(documentProjection.containerId, uniqueContainerIds));
  }

  if (uniqueDocumentIds.length > 0) {
    filters.push(inArray(documentProjection.documentId, uniqueDocumentIds));
  }

  const whereCondition = filters.length === 1 ? filters[0] : or(...filters);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select(documentSummarySelection)
    .from(documentProjection)
    .leftJoin(documents, documentSummaryJoin)
    .where(
      and(
        whereCondition,
        notInArray(
          documentProjection.documentKind,
          HIDDEN_DOCUMENT_SUMMARY_KINDS,
        ),
      ),
    )
    .orderBy(
      desc(documentProjection.updatedAt),
      desc(documentProjection.localId),
    );

  return rows.map(mapDocumentSummary);
}

function buildDiscardShellDocument(
  localId: string,
  existingDocument: StoredDocumentRecord,
): StoredDocumentRecord {
  return {
    id: localId,
    accessEpoch: existingDocument.accessEpoch,
    accessStateHash: existingDocument.accessStateHash ?? null,
    containerId: existingDocument.containerId,
    contentKeyBundle: null,
    documentId: existingDocument.documentId,
    documentKekTargets: null,
    documentManifestBundle: null,
    effectiveAccessLevel: existingDocument.effectiveAccessLevel ?? null,
    lastCommitLsn: null,
    loroSnapshot: "",
    pendingBaseVersion: null,
    text: "",
    ...(existingDocument.documentKind === undefined
      ? {}
      : { documentKind: existingDocument.documentKind }),
    ...(existingDocument.title === undefined
      ? {}
      : { title: existingDocument.title }),
  };
}

// The single transaction behind discardDocumentToShell: row teardown and the
// shell upsert commit together, so an interruption leaves either the fully
// old or the fully shelled document. Staged-upload rows AND detached
// local-attachment markers both go: a marker for a locally-discarded detach
// would otherwise keep filtering the slot out of every projection after the
// re-pull restores it (hydration skips the slot because its cached storage
// key still matches), leaving the attachment permanently invisible.
async function discardDocumentRowsToShell(input: {
  existingDocument: StoredDocumentRecord;
  localId: string;
  lockedExecSql: ExecSql;
  pendingAttachments: ReadonlyArray<{ slotId: string; storageKey: string }>;
}): Promise<void> {
  const { existingDocument, localId, lockedExecSql, pendingAttachments } =
    input;
  const shellDocument = buildDiscardShellDocument(localId, existingDocument);
  await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
    async (tx) => {
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getDocumentScope(localId),
      );
      await tx
        .delete(documentPendingAttachments)
        .where(eq(documentPendingAttachments.localId, localId))
        .run();
      for (const pendingAttachment of pendingAttachments) {
        await tx
          .delete(documentAttachmentBlobProjection)
          .where(
            and(
              eq(documentAttachmentBlobProjection.localId, localId),
              eq(
                documentAttachmentBlobProjection.slotId,
                pendingAttachment.slotId,
              ),
              eq(
                documentAttachmentBlobProjection.storageKey,
                pendingAttachment.storageKey,
              ),
            ),
          )
          .run();
      }
      await tx
        .delete(documentAttachmentBlobProjection)
        .where(
          and(
            eq(documentAttachmentBlobProjection.localId, localId),
            isNotNull(documentAttachmentBlobProjection.detachedAt),
          ),
        )
        .run();
      await deleteDocumentHistory(lockedExecSql, getDocumentScope(localId));
      await clearDocumentSyncFailure(lockedExecSql, getDocumentScope(localId));
      const updatedAt = await resolveDocumentSaveTimestamp({
        document: shellDocument,
        tx,
      });
      await saveDocumentRows({
        document: shellDocument,
        tx,
        updatedAt,
      });
    },
  );
}

const sqlStoredDocumentsPersistence: DocumentsPersistence = {
  async ensureSchema(execSql) {
    // Once ensured on this connection, skip the outer mutation lock entirely:
    // ensureSchema runs on every query path, and re-acquiring the lock just to
    // no-op would queue reads behind unrelated writes.
    await runOncePerConnection(execSql, "ensure:documents", () =>
      runSerializedSqlMutation(execSql, async (lockedExecSql) => {
        await ensureDocumentTables(lockedExecSql);
        await ensureDocumentProjectionTables(lockedExecSql);
        await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
      }),
    );
  },
  async listDocuments(execSql) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select(documentSummarySelection)
      .from(documentProjection)
      .leftJoin(documents, documentSummaryJoin)
      .where(
        notInArray(
          documentProjection.documentKind,
          HIDDEN_DOCUMENT_SUMMARY_KINDS,
        ),
      )
      .orderBy(
        desc(documentProjection.updatedAt),
        desc(documentProjection.localId),
      );

    return rows.map(mapDocumentSummary);
  },
  listDocumentSummaries,
  listDocumentsByContainerIdsOrDocumentIds,
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
  async saveDocument(execSql, document, options) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
      getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          const updatedAt = await resolveDocumentSaveTimestamp({
            document,
            options,
            tx,
          });
          await saveDocumentRows({
            document,
            tx,
            updatedAt,
          });

          return updatedAt;
        },
      ),
    );
  },
  async saveDocumentAndDeletePendingUpdates(
    execSql,
    document,
    pendingUpdateIds,
    options,
  ) {
    const uniquePendingUpdateIds = [...new Set(pendingUpdateIds)];

    return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
      getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          const updatedAt = await resolveDocumentSaveTimestamp({
            document,
            options,
            tx,
          });
          if (uniquePendingUpdateIds.length > 0) {
            await tx
              .delete(documentPendingUpdates)
              .where(
                and(
                  eq(documentPendingUpdates.appKind, DOCUMENTS_APP_KIND),
                  eq(documentPendingUpdates.localId, document.id),
                  inArray(documentPendingUpdates.id, uniquePendingUpdateIds),
                ),
              )
              .run();
          }
          await saveDocumentRows({
            document,
            tx,
            updatedAt,
          });

          return updatedAt;
        },
      ),
    );
  },
  async deleteDocument(execSql, localId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      // The move-intent cleanup below touches a table owned by the
      // container-contents schema, which callers of this persistence may not
      // have ensured yet.
      await ensureSqlTables(lockedExecSql, documentMoveIntentTables);
      const existingDocument = await sqlStoredDocumentsPersistence.loadDocument(
        lockedExecSql,
        localId,
      );

      await getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
        async (tx) => {
          await tx
            .delete(documentProjection)
            .where(eq(documentProjection.localId, localId))
            .run();
          await tx
            .delete(documentProjectionText)
            .where(eq(documentProjectionText.localId, localId))
            .run();
          await tx
            .delete(documentPendingAttachments)
            .where(eq(documentPendingAttachments.localId, localId))
            .run();
          await tx
            .delete(documentAttachmentBlobProjection)
            .where(eq(documentAttachmentBlobProjection.localId, localId))
            .run();
          if (existingDocument?.documentId) {
            await tx
              .delete(documentContainerProjection)
              .where(
                eq(
                  documentContainerProjection.documentId,
                  existingDocument.documentId,
                ),
              )
              .run();
            // A queued move for a document that no longer exists can never
            // replay; leaving the row would render a permanent phantom entry
            // in the write queue.
            await tx
              .delete(documentMoveIntents)
              .where(
                eq(documentMoveIntents.documentId, existingDocument.documentId),
              )
              .run();
          }
          await deleteDocumentPendingUpdates(
            lockedExecSql,
            getDocumentScope(localId),
          );
          await deleteDocumentHistory(lockedExecSql, getDocumentScope(localId));
          await clearDocumentSyncFailure(
            lockedExecSql,
            getDocumentScope(localId),
          );
          await deleteDocumentRecord(lockedExecSql, getDocumentScope(localId));
        },
      );
    });
  },
  /**
   * Atomically convert a stuck document's local state to the
   * freshly-discovered-share shell: drop its queued updates, staged
   * attachment rows (and their settled local-attachment halves, which share
   * the staged storage keys the caller reclaims), durable history, and
   * recorded sync failure, then overwrite the record with an empty snapshot
   * that keeps its identity, placement, title, and kind. Everything commits
   * in ONE transaction, so an interruption leaves either the fully old or
   * the fully shelled document — never a record with parts of its durable
   * queue missing.
   *
   * Refused when the document is local-only or unlinked (its rows are the
   * only copy) or when any move intent references it: the local containerId
   * is then the move's optimistic placement, and reseeding it as server
   * truth would silently commit the move locally while discarding the
   * intent that was meant to perform it.
   */
  async discardDocumentToShell(
    execSql,
    localId,
  ): Promise<DiscardDocumentToShellResult> {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureSqlTables(lockedExecSql, documentMoveIntentTables);
      const existingDocument = await sqlStoredDocumentsPersistence.loadDocument(
        lockedExecSql,
        localId,
      );
      if (!existingDocument?.documentId || !existingDocument.containerId) {
        return { discarded: false };
      }
      const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
      const moveIntentRows = await db
        .select({ id: documentMoveIntents.id })
        .from(documentMoveIntents)
        .where(eq(documentMoveIntents.localId, localId))
        .limit(1);
      if (moveIntentRows.length > 0) {
        return { discarded: false };
      }
      const pendingAttachments =
        await sqlStoredDocumentsPersistence.listPendingAttachments(
          lockedExecSql,
          localId,
        );
      const detachedRows = await db
        .select({
          storageKey: documentAttachmentBlobProjection.storageKey,
        })
        .from(documentAttachmentBlobProjection)
        .where(
          and(
            eq(documentAttachmentBlobProjection.localId, localId),
            isNotNull(documentAttachmentBlobProjection.detachedAt),
          ),
        );

      await discardDocumentRowsToShell({
        existingDocument,
        localId,
        lockedExecSql,
        pendingAttachments,
      });
      return {
        discarded: true,
        documentKind: existingDocument.documentKind ?? DEFAULT_DOCUMENT_KIND,
        reclaimableBlobStorageKeys: [
          ...new Set([
            ...pendingAttachments.map(
              (pendingAttachment) => pendingAttachment.storageKey,
            ),
            ...detachedRows.map((detachedRow) => detachedRow.storageKey),
          ]),
        ],
      };
    });
  },
  async upsertDiscoveredDocument(execSql, input) {
    const [nextSummary] = await upsertDiscoveredDocuments(execSql, [input]);
    if (!nextSummary) {
      throw new Error("Failed to upsert discovered document");
    }

    return nextSummary;
  },
  async relinkPersistedDocument(execSql, input) {
    return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await sqlStoredDocumentsPersistence.ensureSchema(lockedExecSql);
      return relinkPersistedDocumentWithExec(lockedExecSql, input);
    });
  },
  async listPendingUpdates(execSql, localId) {
    return listDocumentPendingUpdates(execSql, getDocumentScope(localId));
  },
  async rekeyPendingUpdate(execSql, id) {
    return rekeyDocumentPendingUpdate(execSql, id);
  },
  async listPendingAttachments(execSql, localId) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({
        localId: documentPendingAttachments.localId,
        slotId: documentPendingAttachments.slotId,
        name: documentPendingAttachments.name,
        mimeType: documentPendingAttachments.mimeType,
        storageKey: documentPendingAttachments.storageKey,
        byteLength: documentPendingAttachments.byteLength,
        uploadBlobId: documentPendingAttachments.uploadBlobId,
        uploadContentKey: documentPendingAttachments.uploadContentKey,
        uploadIv: documentPendingAttachments.uploadIv,
        uploadContentKeyEpoch: documentPendingAttachments.uploadContentKeyEpoch,
        uploadPartSize: documentPendingAttachments.uploadPartSize,
        uploadPlaintextSha256: documentPendingAttachments.uploadPlaintextSha256,
        uploadStageId: documentPendingAttachments.uploadStageId,
      })
      .from(documentPendingAttachments)
      .where(eq(documentPendingAttachments.localId, localId))
      .orderBy(
        documentPendingAttachments.createdAt,
        documentPendingAttachments.slotId,
      );

    return rows.map(mapPendingAttachmentRecord);
  },
  // Detached rows are included on purpose: they are the durable markers the
  // next sync uses to detach the remote binding, so a restart has to restore
  // them alongside the live slots.
  async listLocalAttachments(execSql, localId) {
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    const rows = await db
      .select({
        localId: documentAttachmentBlobProjection.localId,
        slotId: documentAttachmentBlobProjection.slotId,
        blobId: documentAttachmentBlobProjection.blobId,
        storageKey: documentAttachmentBlobProjection.storageKey,
        mimeType: documentAttachmentBlobProjection.mimeType,
        byteLength: documentAttachmentBlobProjection.byteLength,
        detachedAt: documentAttachmentBlobProjection.detachedAt,
      })
      .from(documentAttachmentBlobProjection)
      .where(eq(documentAttachmentBlobProjection.localId, localId));

    return rows.map(mapLocalAttachmentRecord);
  },
  async appendHistoryUpdates(execSql, input) {
    await appendDocumentHistoryUpdates(
      execSql,
      getDocumentScope(input.localId),
      input.updates,
    );
  },
  async loadHistoryRestoreState(execSql, localId) {
    return loadDocumentHistoryRestoreState(execSql, getDocumentScope(localId));
  },
  async readHistoryTailSize(execSql, localId) {
    return readDocumentHistoryTailSize(execSql, getDocumentScope(localId));
  },
  async listHistoryTailEntries(execSql, localId) {
    return listDocumentHistoryTailEntries(execSql, getDocumentScope(localId));
  },
  async replaceHistoryCheckpoint(execSql, input) {
    await replaceDocumentHistoryCheckpoint(
      execSql,
      getDocumentScope(input.localId),
      {
        coveredTailIds: input.coveredTailIds,
        endVersionVector: input.endVersionVector,
        ...(input.force === undefined ? {} : { force: input.force }),
        snapshot: input.snapshot,
        ...(input.stillCurrent === undefined
          ? {}
          : { stillCurrent: input.stillCurrent }),
      },
    );
  },
  async enqueuePendingUpdate(execSql, pendingUpdate) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await enqueueDocumentPendingUpdateWithHistory(
        lockedExecSql,
        getDocumentScope(pendingUpdate.localId),
        pendingUpdate,
      );
    });
  },
  async saveLocalAttachment(execSql, attachment) {
    const updatedAt = new Date().toISOString();

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      const attachmentRow = {
        localId: attachment.localId,
        slotId: attachment.slotId,
        blobId: attachment.blobId,
        storageKey: attachment.storageKey,
        mimeType: attachment.mimeType,
        byteLength: attachment.byteLength,
        updatedAt,
        // Written on every save so re-filling a slot clears a stale detach
        // marker instead of inheriting it from the row it replaces.
        detachedAt: attachment.detachedAt,
      };
      await db
        .insert(documentAttachmentBlobProjection)
        .values(attachmentRow)
        .onConflictDoUpdate({
          target: [
            documentAttachmentBlobProjection.localId,
            documentAttachmentBlobProjection.slotId,
          ],
          set: attachmentRow,
        })
        .run();
    });
  },
  async deleteLocalAttachment(execSql, localId, slotId, storageKey) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentAttachmentBlobProjection)
        .where(
          and(
            eq(documentAttachmentBlobProjection.localId, localId),
            eq(documentAttachmentBlobProjection.slotId, slotId),
            eq(documentAttachmentBlobProjection.storageKey, storageKey),
          ),
        )
        .run();
    });
  },
  async markLocalAttachmentDetached(execSql, localId, slotId, storageKey) {
    const detachedAt = new Date().toISOString();

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .update(documentAttachmentBlobProjection)
        .set({ detachedAt })
        .where(
          and(
            eq(documentAttachmentBlobProjection.localId, localId),
            eq(documentAttachmentBlobProjection.slotId, slotId),
            eq(documentAttachmentBlobProjection.storageKey, storageKey),
            isNull(documentAttachmentBlobProjection.detachedAt),
          ),
        )
        .run();
    });
  },
  async savePendingAttachment(execSql, attachment) {
    const createdAt = new Date().toISOString();

    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      const attachmentRow = buildPendingAttachmentRow(attachment, createdAt);
      await db
        .insert(documentPendingAttachments)
        .values(attachmentRow)
        .onConflictDoUpdate({
          target: [
            documentPendingAttachments.localId,
            documentPendingAttachments.slotId,
          ],
          set: {
            name: attachmentRow.name,
            mimeType: attachmentRow.mimeType,
            storageKey: attachmentRow.storageKey,
            byteLength: attachmentRow.byteLength,
            uploadBlobId: attachmentRow.uploadBlobId,
            uploadContentKey: attachmentRow.uploadContentKey,
            uploadIv: attachmentRow.uploadIv,
            uploadContentKeyEpoch: attachmentRow.uploadContentKeyEpoch,
            uploadPartSize: attachmentRow.uploadPartSize,
            uploadPlaintextSha256: attachmentRow.uploadPlaintextSha256,
            uploadStageId: attachmentRow.uploadStageId,
          },
        })
        .run();
    });
  },
  async deletePendingUpdate(execSql, id) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdate(lockedExecSql, id);
    });
  },
  async deletePendingUpdates(execSql, localId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getDocumentScope(localId),
      );
    });
  },
  async deletePendingAttachment(execSql, localId, slotId, storageKey) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentPendingAttachments)
        .where(
          and(
            eq(documentPendingAttachments.localId, localId),
            eq(documentPendingAttachments.slotId, slotId),
            eq(documentPendingAttachments.storageKey, storageKey),
          ),
        )
        .run();
    });
  },
  async deletePendingAttachments(execSql, localId) {
    await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
      await db
        .delete(documentPendingAttachments)
        .where(eq(documentPendingAttachments.localId, localId))
        .run();
    });
  },
};

export const sqlDocumentsPersistence: DocumentsPersistence =
  sqlStoredDocumentsPersistence;
