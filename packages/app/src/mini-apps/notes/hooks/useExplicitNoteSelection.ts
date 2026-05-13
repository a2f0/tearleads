import { useMemo } from "react";
import { DEFAULT_DOCUMENT_ID } from "../../../stores/documents/DocumentsProvider";
import type { ActiveNoteSelection, NotesAppProps } from "../types";

export function useExplicitNoteSelection({
  containerId,
  documentId,
  noteId,
}: NotesAppProps): ActiveNoteSelection | null {
  return useMemo(() => {
    if (
      noteId === undefined &&
      containerId === undefined &&
      documentId === undefined
    ) {
      return null;
    }

    return {
      noteId: noteId ?? documentId ?? DEFAULT_DOCUMENT_ID,
      ...(containerId === undefined ? {} : { containerId }),
      ...(documentId === undefined ? {} : { documentId }),
    };
  }, [containerId, documentId, noteId]);
}
