import {
  type DocumentProjectorRegistry,
  resolveDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import type {
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  StoredDocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";
import {
  commitPreparedDocumentState,
  type PersistDocumentStateInput,
  type PersistedDocumentState,
} from "./documentMutationCommit";

export type {
  AttachmentRemovalRows,
  AttachmentStagingRows,
  DocumentsPersistence,
  LocalAttachmentRecord,
  PendingAttachmentRecord,
  PendingAttachmentUploadIdentity,
  PendingUpdateInsert,
  PendingUpdateRecord,
  RelinkPersistedDocumentInput,
  StoredDocumentRecord as DocumentRecord,
} from "../../data/persistence/documents/documentsPersistence";
export {
  DOCUMENTS_APP_KIND,
  sqlDocumentsPersistence as defaultDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
// Store-layer teardown-safe writers serialize their generation checks on the
// same mutation mutex the persistence implementations use; the facade
// re-export keeps data internals out of the stores.
export { runSerializedSqlMutation } from "../../data/sqlite/sqlSchema";

const projectionSchemaEnsuresByExecSql = new WeakMap<
  ExecSql,
  WeakMap<DocumentProjectorRegistry, Promise<void>>
>();

interface LoadedPersistedDocumentStoreState {
  document: StoredDocumentRecord | null;
  localAttachments: LocalAttachmentRecord[];
  pendingAttachments: PendingAttachmentRecord[];
}

export async function ensureDocumentClientProjectionTables(input: {
  documentProjectors: DocumentProjectorRegistry;
  execSql: ExecSql;
}): Promise<void> {
  let ensuresByProjector = projectionSchemaEnsuresByExecSql.get(input.execSql);
  if (!ensuresByProjector) {
    ensuresByProjector = new WeakMap();
    projectionSchemaEnsuresByExecSql.set(input.execSql, ensuresByProjector);
  }

  const existingEnsure = ensuresByProjector.get(input.documentProjectors);
  if (existingEnsure) {
    await existingEnsure;
    return;
  }

  const tables = input.documentProjectors.getClientProjectionTables();
  if (tables.length === 0) {
    ensuresByProjector.set(input.documentProjectors, Promise.resolve());
    return;
  }

  const ensurePromise = ensureSqlTables(input.execSql, tables).catch(
    (error: unknown) => {
      ensuresByProjector.delete(input.documentProjectors);
      throw error;
    },
  );
  ensuresByProjector.set(input.documentProjectors, ensurePromise);
  await ensurePromise;
}

export async function persistDocumentState(
  input: PersistDocumentStateInput,
): Promise<PersistedDocumentState | null> {
  const documentProjectors = resolveDocumentProjectorRegistry(
    input.documentProjectors,
  );
  await ensureDocumentClientProjectionTables({
    documentProjectors,
    execSql: input.execSql,
  });
  if (input.canStartDurableMutation && !input.canStartDurableMutation()) {
    return null;
  }
  return runSerializedSqlMutation(input.execSql, (lockedExecSql) =>
    commitPreparedDocumentState({
      documentProjectors,
      lockedExecSql,
      patch: input.patch ?? {},
      persistInput: input,
    }),
  );
}

export async function loadPersistedDocumentStoreState(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<LoadedPersistedDocumentStoreState> {
  const { execSql, localId, persistence } = input;
  await persistence.ensureSchema(execSql);
  const [document, pendingAttachments, localAttachments] = await Promise.all([
    persistence.loadDocument(execSql, localId),
    persistence.listPendingAttachments(execSql, localId),
    persistence.listLocalAttachments(execSql, localId),
  ]);
  return { document, localAttachments, pendingAttachments };
}
