import { base64ToBytes } from "@symcrypt/encoding";
import { getImportBlobMetadata, importSnapshot } from "@symcrypt/loro";
import {
  type DocumentsPersistence,
  importDocumentHistoryTailUpdates,
} from "../../../workflows/documents";
import type { DocumentState, DocumentStoreState } from "./state";

export type RestoredHistoryState = NonNullable<
  Awaited<ReturnType<DocumentsPersistence["loadHistoryRestoreState"]>>
>;

export function installRestoredDocumentContent(
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

export async function restorePersistedDocumentContent(
  state: DocumentStoreState,
  nextDoc: DocumentState,
): Promise<RestoredHistoryState | null> {
  const history = await state.persistence.loadHistoryRestoreState(
    state.runtime.infra.execSql,
    state.localId,
  );
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
