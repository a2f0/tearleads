import type { DomainScope } from "../../data/shared/domainScope";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type LoadedDocumentRecord,
  listLoadedRecordsSavedElsewhere,
} from "../../workflows/documents";
import { getOrCreateDocumentStoreRegistry } from "./registry";
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
  const loaded: Array<{
    readonly record: LoadedDocumentRecord;
    readonly store: DocumentStore;
  }> = [];
  for (const store of getOrCreateDocumentStoreRegistry(
    domainScope,
  ).storesByKey.values()) {
    const record = loadedRecordReaders.get(store)?.() ?? null;
    if (record) loaded.push({ record, store });
  }
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
