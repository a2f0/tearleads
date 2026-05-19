import type { DocumentSummary } from "@tearleads/client-sdk";
import { useMemo } from "react";
import type { ActiveNoteSelection } from "../types";

function noteSelectionFromSummary(note: DocumentSummary): ActiveNoteSelection {
  return {
    noteId: note.id,
    containerId: note.containerId,
    documentId: note.documentId,
  };
}

export function useActiveNoteSelection(input: {
  explicitSelection: ActiveNoteSelection | null;
  notes: ReadonlyArray<DocumentSummary>;
  selectedNoteId: string | null;
}): ActiveNoteSelection | null {
  return useMemo(() => {
    const selectedNote =
      input.selectedNoteId === null
        ? null
        : input.notes.find((note) => note.id === input.selectedNoteId);
    if (selectedNote) {
      return noteSelectionFromSummary(selectedNote);
    }

    if (input.explicitSelection) {
      return input.explicitSelection;
    }

    return input.selectedNoteId === null
      ? null
      : { noteId: input.selectedNoteId };
  }, [input.explicitSelection, input.notes, input.selectedNoteId]);
}
