import { useMemo } from "react";
import { DEFAULT_NOTE_ID } from "../../../stores/notes/NotesProvider";
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
      noteId: noteId ?? documentId ?? DEFAULT_NOTE_ID,
      ...(containerId === undefined ? {} : { containerId }),
      ...(documentId === undefined ? {} : { documentId }),
    };
  }, [containerId, documentId, noteId]);
}
