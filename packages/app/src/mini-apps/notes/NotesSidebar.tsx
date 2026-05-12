import { useEffect, useMemo } from "react";
import type { DocumentSummary } from "../../data/documentSummary";
import { getUntitledDocumentTitle } from "../../data/documents/documentKinds";
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
      <button
        type="button"
        className="notes-sidebar-new-note"
        disabled={!ready}
        onClick={createNote}
      >
        New Note
      </button>
      <div className="notes-sidebar-list">
        {!ready ? (
          <div className="notes-sidebar-empty">Loading...</div>
        ) : notes.length === 0 ? (
          <div className="notes-sidebar-empty">No notes.</div>
        ) : (
          notes.map((note) => (
            <button
              key={note.id}
              type="button"
              className={
                "notes-sidebar-item" +
                (selectedNoteId === note.id
                  ? " notes-sidebar-item--selected"
                  : "")
              }
              onClick={() => selectNote(note.id)}
            >
              {getNoteTitle(note)}
            </button>
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

  useEffect(() => {
    setSidebar(sidebar);
    return () => setSidebar(null);
  }, [setSidebar, sidebar]);
}
