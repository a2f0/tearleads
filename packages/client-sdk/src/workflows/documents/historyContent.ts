import { base64ToBytes } from "@tearleads/encoding";
import { createDocument, importSnapshot } from "@tearleads/loro";
import { importDocumentHistoryTailUpdates } from "../../data/documents/documentHistoryImport";
import {
  DOCUMENTS_APP_KIND,
  type DocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { getScopedPeerSeed } from "../../data/sync/crdtPeerSeed";

export { importDocumentHistoryTailUpdates };

/** Merge the latest durable checkpoint and tail into an already-live pane. */
export async function mergePersistedDocumentHistory(input: {
  doc: Parameters<typeof importSnapshot>[0];
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<void> {
  const history = await input.persistence.loadHistoryRestoreState(
    input.execSql,
    input.localId,
  );
  if (!history) return;
  if (history.snapshot.length > 0) {
    importSnapshot(input.doc, base64ToBytes(history.snapshot));
  }
  importDocumentHistoryTailUpdates(
    input.doc,
    history.tailUpdates.map((update) => update.updateData),
  );
}

/**
 * Load a persisted document's content into a fresh detached document from the
 * durable full-history state (checkpoint + tail) — the only persisted content
 * source. Returns null when the document has no checkpoint yet (a discovered
 * shell that has not hydrated). For store-less readers (diagnostics, profile
 * lookups); the document store restores through its own initialization path.
 */
export async function loadPersistedDocumentContent(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<Awaited<ReturnType<typeof createDocument>> | null> {
  const history = await input.persistence.loadHistoryRestoreState(
    input.execSql,
    input.localId,
  );
  return restorePersistedDocumentContent(history);
}

export async function restorePersistedDocumentContent(
  history: Awaited<ReturnType<DocumentsPersistence["loadHistoryRestoreState"]>>,
): Promise<Awaited<ReturnType<typeof createDocument>> | null> {
  if (!history) return null;
  const doc = await createDocument(await getScopedPeerSeed(DOCUMENTS_APP_KIND));
  try {
    // A tail-only state has no birth checkpoint. Replay its rows on the empty document.
    if (history.snapshot) importSnapshot(doc, base64ToBytes(history.snapshot));
    importDocumentHistoryTailUpdates(
      doc,
      history.tailUpdates.map((update) => update.updateData),
    );
    return doc;
  } catch (error) {
    doc.free();
    throw error;
  }
}
