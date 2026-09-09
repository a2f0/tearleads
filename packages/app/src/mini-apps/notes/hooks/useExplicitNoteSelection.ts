import { useMemo } from "react";
import { createDocumentDraft } from "../../../stores/documents/documentDraft";
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
      noteId: noteId ?? documentId ?? createDocumentDraft({ containerId }).id,
      ...(containerId === undefined ? {} : { containerId }),
      ...(documentId === undefined ? {} : { documentId }),
    };
  }, [containerId, documentId, noteId]);
}
