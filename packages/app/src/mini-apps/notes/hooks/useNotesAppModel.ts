import { useNotesSidebarPanel } from "../NotesSidebar";
import type {
  ActiveNoteSelection,
  NotesAppProps,
  NotesSetSidebar,
} from "../types";
import { useActiveNoteSelection } from "./useActiveNoteSelection";
import { useExplicitNoteSelection } from "./useExplicitNoteSelection";
import { useNotesDirectory } from "./useNotesDirectory";

interface NotesAppModel {
  activeSelection: ActiveNoteSelection | null;
  createNote: () => void;
  ready: boolean;
}

export function useNotesAppModel(
  props: NotesAppProps,
  setSidebar: NotesSetSidebar,
): NotesAppModel {
  const explicitSelection = useExplicitNoteSelection(props);
  const { createNote, notes, ready, selectedNoteId, selectNote } =
    useNotesDirectory(explicitSelection?.noteId ?? null);
  const activeSelection = useActiveNoteSelection({
    explicitSelection,
    notes,
    selectedNoteId,
  });

  useNotesSidebarPanel({
    notes,
    ready,
    selectNote,
    selectedNoteId,
    setSidebar,
  });

  return { activeSelection, createNote, ready };
}
