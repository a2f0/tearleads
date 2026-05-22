import {
  type DocumentSummary,
  getUntitledDocumentTitle,
} from "@tearleads/client-sdk/documents";
import { useMemo } from "react";
import {
  MiniAppSidebar,
  MiniAppSidebarList,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
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
    <MiniAppSidebar spacious>
      <MiniAppRowButton disabled={!ready} onClick={createNote} variant="framed">
        <MiniAppRowText>{NOTES_LABELS.sidebarNewNote}</MiniAppRowText>
      </MiniAppRowButton>
      <MiniAppSidebarList>
        {!ready ? (
          <MiniAppStatus className="notes-sidebar-empty">
            {NOTES_LABELS.sidebarLoading}
          </MiniAppStatus>
        ) : notes.length === 0 ? (
          <MiniAppStatus className="notes-sidebar-empty">
            {NOTES_LABELS.sidebarEmpty}
          </MiniAppStatus>
        ) : (
          notes.map((note) => (
            <MiniAppRowButton
              key={note.id}
              onClick={() => selectNote(note.id)}
              selected={selectedNoteId === note.id}
            >
              <MiniAppRowText>{getNoteTitle(note)}</MiniAppRowText>
            </MiniAppRowButton>
          ))
        )}
      </MiniAppSidebarList>
    </MiniAppSidebar>
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
