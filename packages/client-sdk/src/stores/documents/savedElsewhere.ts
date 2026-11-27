import type { DomainScope } from "../../data/shared/domainScope";
import {
  type ExecSql,
  type LoadedDocumentRecord,
  listLoadedRecordsSavedElsewhere,
  type OwedDocumentRecord,
} from "../../workflows/documents";
import { listRegisteredDocumentStores } from "./registry";
import type { DocumentStore } from "./types";

type LoadedRecordReader = () => LoadedDocumentRecord | null;

const loadedRecordReaders = new WeakMap<DocumentStore, LoadedRecordReader>();

/**
 * How a backing store describes the remote record it has loaded; null while
 * it holds none.
 */
export function registerDocumentStoreLoadedRecord(
  store: DocumentStore,
  read: LoadedRecordReader,
): void {
  loadedRecordReaders.set(store, read);
}

/** A facade describes the loaded record of the store it wraps. */
export function forwardDocumentStoreLoadedRecord(
  facade: DocumentStore,
  target: DocumentStore,
): void {
  loadedRecordReaders.set(
    facade,
    () => loadedRecordReaders.get(target)?.() ?? null,
  );
}

/** Every registered store with the record it has loaded. */
function listLoadedStores(domainScope: DomainScope) {
  const loaded: Array<{
    readonly record: LoadedDocumentRecord;
    readonly store: DocumentStore;
  }> = [];
  for (const store of listRegisteredDocumentStores(domainScope)) {
    const record = loadedRecordReaders.get(store)?.() ?? null;
    if (record) loaded.push({ record, store });
  }
  return loaded;
}

/**
 * Asks each registered store whose loaded record owes a listing's read for
 * one remote pull. A debt belongs to a record, and another record of the
 * same document can hold the document's store, so a store is asked only for
 * its own record's debt. A store that has not loaded its record reads the
 * debt itself when it does.
 */
export function requestRemoteSyncsOfOwedRecords(
  domainScope: DomainScope,
  owed: ReadonlyArray<OwedDocumentRecord>,
): void {
  if (owed.length === 0) return;
  const owedLocalIds = new Set(owed.map(({ localId }) => localId));
  for (const { record, store } of listLoadedStores(domainScope)) {
    if (owedLocalIds.has(record.localId)) store.requestRemoteSync();
  }
}

/**
 * Asks every registered store that lacks content its record has on disk for
 * one remote pull, and returns how many were asked. See
 * `listLoadedRecordsSavedElsewhere`: another runtime sharing the database
 * saved that content, and no listing will name the document to this one.
 */
export async function requestRemoteSyncsOfRecordsSavedElsewhere(
  domainScope: DomainScope,
  execSql: ExecSql,
): Promise<number> {
  const loaded = listLoadedStores(domainScope);
  if (loaded.length === 0) return 0;
  const behind = await listLoadedRecordsSavedElsewhere(
    execSql,
    loaded.map(({ record }) => record),
  );
  let requested = 0;
  for (const { record, store } of loaded) {
    if (!behind.has(record.localId)) continue;
    store.requestRemoteSync();
    requested += 1;
  }
  return requested;
}
