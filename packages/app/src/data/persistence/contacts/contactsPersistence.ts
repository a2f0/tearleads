import { and, asc, eq, sql } from "drizzle-orm";
import type { AddressBookEntry } from "../../../mini-apps/contacts/types";
import { getAppDatabaseRuntime } from "../appDatabaseRuntime";
import {
  type DocumentRecord,
  type DocumentScope,
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  mapSelectedDocumentRecord,
  type PendingUpdateFields,
  type PendingUpdateRecord,
  type SelectedDocumentRecordRow,
  saveDocumentRecord,
} from "../documentPersistence";
import {
  addressBookProjection,
  addressBookProjectionTables,
  documents,
} from "../schema";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../sqlSchema";

export interface ContactPendingUpdateInsert extends PendingUpdateFields {
  userId: string;
}

export interface StoredContact {
  entry: AddressBookEntry;
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
    entry: AddressBookEntry,
  ) => Promise<void>;
  deleteContact: (
    execSql: ExecSql,
    addressBookId: string,
    userId: string,
  ) => Promise<void>;
  listPendingUpdates: (
    execSql: ExecSql,
    userId: string,
  ) => Promise<PendingUpdateRecord[]>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: ContactPendingUpdateInsert,
  ) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
  deletePendingUpdates: (execSql: ExecSql, userId: string) => Promise<void>;
}

const CONTACTS_APP_KIND = "contacts";

function getContactScope(userId: string): DocumentScope {
  return {
    appKind: CONTACTS_APP_KIND,
    localId: userId,
  };
}

type NullableSelectedDocumentRecordRow = {
  [Key in keyof SelectedDocumentRecordRow]:
    | SelectedDocumentRecordRow[Key]
    | null;
};

interface SelectedStoredContact extends NullableSelectedDocumentRecordRow {
  userId: string;
  encapsulationPublicKey: string;
  isSelf: number;
}

function mapAddressBookEntry(row: SelectedStoredContact): AddressBookEntry {
  return {
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
    entry: mapAddressBookEntry(row),
    record,
  };
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
          eq(documents.localId, addressBookProjection.userId),
        ),
      )
      .where(eq(addressBookProjection.addressBookId, addressBookId))
      .orderBy(asc(sql`${addressBookProjection.userId} COLLATE NOCASE`));

    return rows.map((row) => mapStoredContact(row));
  },
  async saveContact(execSql, addressBookId, record, entry) {
    const updatedAt = new Date().toISOString();

    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await getAppDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        await saveDocumentRecord(
          lockedExecSql,
          getContactScope(entry.userId),
          {
            ...record,
            id: entry.userId,
          },
          updatedAt,
        );
        const projectionRow = {
          addressBookId,
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
              addressBookProjection.userId,
            ],
            set: {
              encapsulationPublicKey: projectionRow.encapsulationPublicKey,
              isSelf: projectionRow.isSelf,
              updatedAt: projectionRow.updatedAt,
            },
          })
          .run();
      });
    });
  },
  async deleteContact(execSql, addressBookId, userId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await getAppDatabaseRuntime(lockedExecSql).transaction(async (tx) => {
        await tx
          .delete(addressBookProjection)
          .where(
            and(
              eq(addressBookProjection.addressBookId, addressBookId),
              eq(addressBookProjection.userId, userId),
            ),
          )
          .run();
        await deleteDocumentRecord(lockedExecSql, getContactScope(userId));
        await deleteDocumentPendingUpdates(
          lockedExecSql,
          getContactScope(userId),
        );
      });
    });
  },
  async listPendingUpdates(execSql, userId) {
    return listDocumentPendingUpdates(execSql, getContactScope(userId));
  },
  async enqueuePendingUpdate(execSql, pendingUpdate) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await enqueueDocumentPendingUpdate(
        lockedExecSql,
        getContactScope(pendingUpdate.userId),
        pendingUpdate,
      );
    });
  },
  async deletePendingUpdate(execSql, id) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdate(lockedExecSql, id);
    });
  },
  async deletePendingUpdates(execSql, userId) {
    await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
      await deleteDocumentPendingUpdates(
        lockedExecSql,
        getContactScope(userId),
      );
    });
  },
};
