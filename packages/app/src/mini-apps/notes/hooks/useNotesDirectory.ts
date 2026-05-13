import { usePersistedNotesDirectory } from "../../../stores/documents/notesDirectory";
import type { ActiveNoteSelection } from "../types";

export function useNotesDirectory(
  explicitSelection: ActiveNoteSelection | null,
) {
  return usePersistedNotesDirectory(explicitSelection?.noteId ?? null);
}
