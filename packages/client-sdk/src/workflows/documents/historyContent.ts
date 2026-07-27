import { base64ToBytes } from "@tearleads/encoding";
import {
  createDocument,
  getImportBlobMetadata,
  importSnapshot,
  importUpdates,
} from "@tearleads/loro";
import { getScopedPeerSeed } from "../../data/crdtPeerSeed";
import {
  DOCUMENTS_APP_KIND,
  type DocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

/**
 * Import durable-history tail rows into a document. Rotation baselines travel
 * through the tail as snapshot-mode blobs, which importUpdates would silently
 * ignore — import them individually.
 */
export function importDocumentHistoryTailUpdates(
  doc: Parameters<typeof importSnapshot>[0],
  tailUpdates: readonly string[],
): void {
  const ordinaryUpdates: Uint8Array[] = [];
  for (const encoded of tailUpdates) {
    const bytes = base64ToBytes(encoded);
    if (getImportBlobMetadata(bytes).mode === "snapshot") {
      importSnapshot(doc, bytes);
    } else {
      ordinaryUpdates.push(bytes);
    }
  }
  if (ordinaryUpdates.length > 0) {
    importUpdates(doc, ordinaryUpdates);
  }
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
  if (!history) {
    return null;
  }

  const doc = await createDocument(await getScopedPeerSeed(DOCUMENTS_APP_KIND));
  // A tail-only state (crash before the birth checkpoint landed) has an
  // empty snapshot; the tail rows alone carry the content.
  if (history.snapshot.length > 0) {
    importSnapshot(doc, base64ToBytes(history.snapshot));
  }
  importDocumentHistoryTailUpdates(doc, history.tailUpdates);
  return doc;
}
