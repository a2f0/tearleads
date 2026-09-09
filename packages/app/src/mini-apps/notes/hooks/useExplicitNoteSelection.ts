import { useMemo } from "react";
import { useDocumentDraft } from "../../../stores/documents/useDocumentDraft";
import type { ActiveNoteSelection, NotesAppProps } from "../types";

export function useExplicitNoteSelection({
  containerId,
  documentId,
  noteId,
}: NotesAppProps): ActiveNoteSelection | null {
  const { draft } = useDocumentDraft({ containerId });
  return useMemo(() => {
    if (
      noteId === undefined &&
      containerId === undefined &&
      documentId === undefined
    ) {
      return null;
    }

    return {
      noteId: noteId ?? documentId ?? draft.id,
      ...(containerId === undefined ? {} : { containerId }),
      ...(documentId === undefined ? {} : { documentId }),
    };
  }, [containerId, documentId, draft.id, noteId]);
}
