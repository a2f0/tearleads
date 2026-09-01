import { base64ToBytes } from "@tearleads/encoding";
import { getImportBlobMetadata, importSnapshot } from "@tearleads/loro";
import {
  type DocumentsPersistence,
  importDocumentHistoryTailUpdates,
} from "../../../workflows/documents";
import type { DocumentState } from "./state";

export type RestoredHistoryState = NonNullable<
  Awaited<ReturnType<DocumentsPersistence["loadHistoryRestoreState"]>>
>;

function installRestoredDocumentContent(
  nextDoc: DocumentState,
  history: RestoredHistoryState,
): void {
  if (history.snapshot.length > 0) {
    importSnapshot(nextDoc, base64ToBytes(history.snapshot));
  }
  importDocumentHistoryTailUpdates(
    nextDoc,
    history.tailUpdates.map((update) => update.updateData),
  );
}

export function restorePersistedDocumentContent(
  nextDoc: DocumentState,
  history: RestoredHistoryState | null,
): RestoredHistoryState | null {
  if (!history) return null;
  installRestoredDocumentContent(nextDoc, history);
  return history;
}

export function restoredRemoteTailCoverage(
  history: RestoredHistoryState | null,
): string[] {
  if (!history) return [];
  return history.tailUpdates.flatMap((update) => {
    if (update.origin !== "remote") return [];
    try {
      return [
        getImportBlobMetadata(base64ToBytes(update.updateData))
          .partialEndVersionVector,
      ];
    } catch {
      return [];
    }
  });
}
