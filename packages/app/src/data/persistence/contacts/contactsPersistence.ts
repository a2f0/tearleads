import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { ContactEntry } from "../../contacts/addressBookEntry";
import {
  type AppSQLiteTransaction,
  getAppDatabaseRuntime,
} from "../../sqlite/appDatabaseRuntime";
import {
  type DocumentRecord,
  type DocumentScope,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  mapSelectedDocumentRecord,
  type PendingUpdateFields,
  type PendingUpdateRecord,
  type SelectedDocumentRecordRow,
} from "../../sqlite/documentPersistence";
import {
  addressBookProjection,
  addressBookProjectionTables,
  documentPendingUpdates,
  documents,
} from "../../sqlite/schema";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";

export interface ContactPendingUpdateInsert extends PendingUpdateFields {
  contactId: string;
}

export interface StoredContact {
  entry: ContactEntry;
  record: DocumentRecord | null;
}

export interface ContactsPersistence {
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  loadContacts: (
    execSql: ExecSql,
    addressBookId: string,
  ) => Promise<ReadonlyArray<StoredContact>>;
  saveContact: (
    execSql: ExecSql,
    addressBookId: string,
    record: DocumentRecord,
    entry: ContactEntry,
  ) => Promise<void>;
  saveContactAndDeletePendingUpdates: (
    execSql: ExecSql,
    addressBookId: string,
    record: DocumentRecord,
    entry: ContactEntry,
    pendingUpdateIds: readonly string[],
  ) => Promise<void>;
  deleteContact: (
    execSql: ExecSql,
    addressBookId: string,
    contactId: string,
  ) => Promise<void>;
  listPendingUpdates: (
    execSql: ExecSql,
    contactId: string,
  ) => Promise<PendingUpdateRecord[]>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: ContactPendingUpdateInsert,
  ) => Promise<void>;
  deletePendingUpdates: (execSql: ExecSql, contactId: string) => Promise<void>;
}

const CONTACTS_APP_KIND = "contacts";

function getContactScope(contactId: string): DocumentScope {
  return {
    appKind: CONTACTS_APP_KIND,
    localId: contactId,
  };
}

type NullableSelectedDocumentRecordRow = {
  [Key in keyof SelectedDocumentRecordRow]:
    | SelectedDocumentRecordRow[Key]
    | null;
};

interface SelectedStoredContact extends NullableSelectedDocumentRecordRow {
  contactId: string;
  firstName: string;
  lastName: string;
  userId: string | null;
  encapsulationPublicKey: string | null;
  isSelf: number;
}

function mapContactEntry(row: SelectedStoredContact): ContactEntry {
  return {
    id: row.contactId,
    firstName: row.firstName,
    lastName: row.lastName,
    userId: row.userId,
    encapsulationPublicKey: row.encapsulationPublicKey,
    isSelf: row.isSelf === 1,
  };
}

function mapStoredContact(row: SelectedStoredContact): StoredContact {
  const record: DocumentRecord | null =
    row.id === null
      ? null
      : mapSelectedDocumentRecord({
          id: row.id,
          documentId: row.documentId,
          loroSnapshot: row.loroSnapshot ?? "",
          accessEpoch: row.accessEpoch ?? 1,
          accessStateHash: row.accessStateHash,
          lastCommitLsn: row.lastCommitLsn,
          documentManifestBundle: row.documentManifestBundle,
          contentKeyBundle: row.contentKeyBundle,
          documentKekTargets: row.documentKekTargets,
        });

  return {
    entry: mapContactEntry(row),
    record,
  };
}

async function saveContactRows(
  tx: AppSQLiteTransaction,
  addressBookId: string,
  record: DocumentRecord,
  entry: ContactEntry,
  updatedAt: string,
) {
  const documentRow = {
    appKind: CONTACTS_APP_KIND,
    localId: entry.id,
    documentId: record.documentId,
    loroSnapshot: record.loroSnapshot,
    accessEpoch: record.accessEpoch,
    accessStateHash: record.accessStateHash ?? null,
    lastCommitLsn: record.lastCommitLsn ?? null,
    documentManifestBundle: record.documentManifestBundle ?? null,
    contentKeyBundle: record.contentKeyBundle ?? null,
    documentKekTargets: record.documentKekTargets ?? null,
    updatedAt,
  };
  await tx
    .insert(documents)
    .values(documentRow)
    .onConflictDoUpdate({
      target: [documents.appKind, documents.localId],
      set: documentRow,
    })
    .run();

  const projectionRow = {
    addressBookId,
    contactId: entry.id,
    firstName: entry.firstName,
    lastName: entry.lastName,
    userId: entry.userId,
    encapsulationPublicKey: entry.encapsulationPublicKey,
    isSelf: entry.isSelf ? 1 : 0,
    updatedAt,
  };
  await tx
    .insert(addressBookProjection)
    .values(projectionRow)
    .onConflictDoUpdate({
      target: [
        addressBookProjection.addressBookId,
        addressBookProjection.contactId,
      ],
      set: {
        firstName: projectionRow.firstName,
        lastName: projectionRow.lastName,
        userId: projectionRow.userId,
        encapsulationPublicKey: projectionRow.encapsulationPublicKey,
        isSelf: projectionRow.isSelf,
        updatedAt: projectionRow.updatedAt,
      },
    })
    .run();
}

export const sqlContactsPersistence: ContactsPersistence = {
  async ensureSchema(execSql) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await ensureDocumentTables(lockedExecSql);
      await ensureSqlTables(lockedExecSql, addressBookProjectionTables);
    });
  },
  async loadContacts(execSql, addressBookId) {
    const { db } = getAppDatabaseRuntime(execSql);
    const rows = await db
      .select({
        contactId: addressBookProjection.contactId,
        firstName: addressBookProjection.firstName,
        lastName: addressBookProjection.lastName,
        userId: addressBookProjection.userId,
        encapsulationPublicKey: addressBookProjection.encapsulationPublicKey,
        isSelf: addressBookProjection.isSelf,
        id: documents.localId,
        documentId: documents.documentId,
        loroSnapshot: documents.loroSnapshot,
        accessEpoch: documents.accessEpoch,
        accessStateHash: documents.accessStateHash,
        lastCommitLsn: documents.lastCommitLsn,
        documentManifestBundle: documents.documentManifestBundle,
        contentKeyBundle: documents.contentKeyBundle,
        documentKekTargets: documents.documentKekTargets,
      })
      .from(addressBookProjection)
      .leftJoin(
        documents,
        and(
          eq(documents.appKind, CONTACTS_APP_KIND),
          eq(documents.localId, addressBookProjection.contactId),
        ),
      )
      .where(eq(addressBookProjection.addressBookId, addressBookId))
      .orderBy(
        asc(sql`${addressBookProjection.lastName} COLLATE NOCASE`),
        asc(sql`${addressBookProjection.firstName} COLLATE NOCASE`),
        asc(sql`${addressBookProjection.userId} COLLATE NOCASE`),
        asc(sql`${addressBookProjection.contactId} COLLATE NOCASE`),
      );

    return rows.map((row) => mapStoredContact(row));
  },
  async saveContact(execSql, addressBookId, record, entry) {
    const updatedAt = new Date().toISOString();

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await getAppDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        await saveContactRows(
          tx,
          addressBookId,
          {
            ...record,
            id: entry.id,
          },
          entry,
          updatedAt,
        );
      });
    });
  },
  async saveContactAndDeletePendingUpdates(
    execSql,
    addressBookId,
    record,
    entry,
    pendingUpdateIds,
  ) {
    const updatedAt = new Date().toISOString();
    const contactScope = getContactScope(entry.id);
    const uniquePendingUpdateIds = [...new Set(pendingUpdateIds)];

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await getAppDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        if (uniquePendingUpdateIds.length > 0) {
          await tx
            .delete(documentPendingUpdates)
            .where(
              and(
                eq(documentPendingUpdates.appKind, contactScope.appKind),
                eq(documentPendingUpdates.localId, contactScope.localId),
                inArray(documentPendingUpdates.id, uniquePendingUpdateIds),
              ),
            )
            .run();
        }

        await saveContactRows(
          tx,
          addressBookId,
          {
            ...record,
            id: entry.id,
          },
          entry,
          updatedAt,
        );
      });
    });
  },
  async deleteContact(execSql, addressBookId, contactId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await getAppDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        await tx
          .delete(addressBookProjection)
          .where(
            and(
              eq(addressBookProjection.addressBookId, addressBookId),
              eq(addressBookProjection.contactId, contactId),
            ),
          )
          .run();
        await deleteDocumentRecord(lockedExecSql, getContactScope(contactId));
        await deleteDocumentPendingUpdates(
          lockedExecSql,
          getContactScope(contactId),
        );
      });
    });
  },
  async listPendingUpdates(execSql, contactId) {
    return listDocumentPendingUpdates(execSql, getContactScope(contactId));
  },
  async enqueuePendingUpdate(execSql, pendingUpdate) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await enqueueDocumentPendingUpdate(
        lockedExecSql,
        getContactScope(pendingUpdate.contactId),
        pendingUpdate,
      );
    });
  },
  async deletePendingUpdates(execSql, contactId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getContactScope(contactId),
      );
    });
  },
};
