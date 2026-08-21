import {
  DEFAULT_DOCUMENT_KIND,
  type StoredDocumentKind,
} from "@symcrypt/client-sdk";
import { useCallback, useMemo, useState } from "react";

// Tracks which documents should mount directly in edit mode. Two producers feed
// it: creating a new structured document (so it opens ready to fill in), and
// returning from the blob picker (so attaching an existing blob doesn't drop the
// user out of edit mode — the picker round-trip navigates away and remounts the
// document, discarding its local `isEditing` state). The flag is one-shot: the
// detail panel consumes it once the document has mounted, so a later plain
// re-selection of the same document doesn't force edit mode.
interface InitialDocumentEditing {
  // True when the given document should mount directly in edit mode. An absent
  // localId (no selected document) reads as false.
  documentStartsInEditMode: (localId: string | undefined) => boolean;
  // Marks a freshly-created structured document to open in edit mode. Plain
  // notes are always editable and have no edit toggle, so they are skipped.
  trackCreatedDocument: (
    localId: string,
    documentKind: StoredDocumentKind,
  ) => void;
  // Marks a document to (re)enter edit mode on its next mount, regardless of
  // kind. Used when returning from the blob picker: the "Choose Blob" affordance
  // is only reachable from edit mode, so resuming it on return keeps the user
  // where they were instead of dropping them to read mode mid-attach.
  markDocumentStartsInEditMode: (localId: string) => void;
  // Clears the flag once a document has mounted, keeping it one-shot.
  consumeInitialDocumentEditing: (localId: string) => void;
}

export function useInitialDocumentEditing(): InitialDocumentEditing {
  const [documentIds, setDocumentIds] = useState(() => new Set<string>());

  const markDocumentStartsInEditMode = useCallback((localId: string) => {
    setDocumentIds((current) => {
      if (current.has(localId)) {
        return current;
      }

      const next = new Set(current);
      next.add(localId);
      return next;
    });
  }, []);

  const trackCreatedDocument = useCallback(
    (localId: string, documentKind: StoredDocumentKind) => {
      if (documentKind === DEFAULT_DOCUMENT_KIND) {
        return;
      }

      markDocumentStartsInEditMode(localId);
    },
    [markDocumentStartsInEditMode],
  );

  const consumeInitialDocumentEditing = useCallback((localId: string) => {
    setDocumentIds((current) => {
      if (!current.has(localId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(localId);
      return next;
    });
  }, []);

  const documentStartsInEditMode = useCallback(
    (localId: string | undefined) =>
      localId !== undefined && documentIds.has(localId),
    [documentIds],
  );

  return useMemo(
    () => ({
      consumeInitialDocumentEditing,
      documentStartsInEditMode,
      markDocumentStartsInEditMode,
      trackCreatedDocument,
    }),
    [
      consumeInitialDocumentEditing,
      documentStartsInEditMode,
      markDocumentStartsInEditMode,
      trackCreatedDocument,
    ],
  );
}
