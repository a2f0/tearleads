import type { DocumentSummary } from "@tearleads/client-sdk";
import { getUntitledDocumentTitle } from "@tearleads/client-sdk";
import { useMemo } from "react";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import { useRegisteredWindowSidebar } from "../../components/window/WindowSidebarContext";
import { NOTES_LABELS } from "./labels";
import type { NotesSetSidebar } from "./types";

interface NotesSidebarProps {
  createNote: () => void;
  notes: ReadonlyArray<DocumentSummary>;
  ready: boolean;
  selectNote: (noteId: string) => void;
  selectedNoteId: string | null;
}

function getNoteTitle(note: DocumentSummary): string {
  return note.title.trim() || getUntitledDocumentTitle("note");
}

function NotesSidebar({
  createNote,
  notes,
  ready,
  selectNote,
  selectedNoteId,
}: NotesSidebarProps) {
  return (
    <div className="notes-sidebar">
      <MiniAppRowButton
        className="notes-sidebar-new-note"
        disabled={!ready}
        onClick={createNote}
        variant="framed"
      >
        <MiniAppRowText>{NOTES_LABELS.sidebarNewNote}</MiniAppRowText>
      </MiniAppRowButton>
      <div className="notes-sidebar-list">
        {!ready ? (
          <div className="notes-sidebar-empty">
            {NOTES_LABELS.sidebarLoading}
          </div>
        ) : notes.length === 0 ? (
          <div className="notes-sidebar-empty">{NOTES_LABELS.sidebarEmpty}</div>
        ) : (
          notes.map((note) => (
            <MiniAppRowButton
              key={note.id}
              className="notes-sidebar-item"
              onClick={() => selectNote(note.id)}
              selected={selectedNoteId === note.id}
            >
              <MiniAppRowText>{getNoteTitle(note)}</MiniAppRowText>
            </MiniAppRowButton>
          ))
        )}
      </div>
    </div>
  );
}

export function useNotesSidebarPanel(
  params: NotesSidebarProps & {
    setSidebar: NotesSetSidebar;
  },
) {
  const { createNote, notes, ready, selectNote, selectedNoteId, setSidebar } =
    params;
  const sidebar = useMemo(
    () => (
      <NotesSidebar
        createNote={createNote}
        notes={notes}
        ready={ready}
        selectNote={selectNote}
        selectedNoteId={selectedNoteId}
      />
    ),
    [createNote, notes, ready, selectNote, selectedNoteId],
  );

  useRegisteredWindowSidebar({ setSidebar, sidebar });
}
