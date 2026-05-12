import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import type { DocumentSummary } from "../../data/documentSummary";
import { getUntitledDocumentTitle } from "../../data/documents/documentKinds";
import { useAppData } from "../../providers/data/AppDataProvider";
import { subscribeToPersistedDocuments } from "../../stores/documents/DocumentsProvider";
import {
  DEFAULT_NOTE_ID,
  NotesProvider,
} from "../../stores/notes/NotesProvider";
import { defaultNotesPersistence } from "../../workflows/notes";
import { Notes } from "./Notes";

interface NotesAppProps {
  noteId?: string;
  containerId?: string | null;
  documentId?: string | null;
}

interface ActiveNoteSelection {
  noteId: string;
  containerId?: string | null;
  documentId?: string | null;
}

interface NotesSidebarProps {
  createNote: () => void;
  notes: ReadonlyArray<DocumentSummary>;
  ready: boolean;
  selectNote: (noteId: string) => void;
  selectedNoteId: string | null;
}

export function createNotesWindowComponent({
  noteId,
  containerId,
  documentId,
}: NotesAppProps = {}) {
  function NotesWindowComponent() {
    return (
      <NotesApp
        {...(noteId === undefined ? {} : { noteId })}
        {...(containerId === undefined ? {} : { containerId })}
        {...(documentId === undefined ? {} : { documentId })}
      />
    );
  }

  NotesWindowComponent.displayName = `NotesWindow(${noteId ?? DEFAULT_NOTE_ID})`;
  return NotesWindowComponent;
}

function isNoteSummary(documentSummary: DocumentSummary): boolean {
  return (documentSummary.documentKind ?? "note") === "note";
}

function compareNoteSummaries(
  left: DocumentSummary,
  right: DocumentSummary,
): number {
  const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
  return updatedAtComparison === 0
    ? right.id.localeCompare(left.id)
    : updatedAtComparison;
}

function mergeNoteSummary(
  currentNotes: ReadonlyArray<DocumentSummary>,
  nextNote: DocumentSummary,
): DocumentSummary[] {
  if (!isNoteSummary(nextNote)) {
    return [...currentNotes];
  }

  const notesById = new Map(currentNotes.map((note) => [note.id, note]));
  notesById.set(nextNote.id, nextNote);

  return Array.from(notesById.values()).sort(compareNoteSummaries);
}

function noteSelectionFromSummary(note: DocumentSummary): ActiveNoteSelection {
  return {
    noteId: note.id,
    containerId: note.containerId,
    documentId: note.documentId,
  };
}

function useExplicitNoteSelection({
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

function useNotesDirectory(explicitSelection: ActiveNoteSelection | null) {
  const appData = useAppData();
  const [notes, setNotes] = useState<ReadonlyArray<DocumentSummary>>([]);
  const [ready, setReady] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    explicitSelection?.noteId ?? null,
  );
  const explicitSelectionRef = useRef(explicitSelection);

  useEffect(() => {
    explicitSelectionRef.current = explicitSelection;
    if (explicitSelection) {
      setSelectedNoteId(explicitSelection.noteId);
    }
  }, [explicitSelection]);

  useEffect(() => {
    if (appData.dbStatus !== "ready") {
      setNotes([]);
      setReady(false);
      if (!explicitSelectionRef.current) {
        setSelectedNoteId(null);
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await defaultNotesPersistence.ensureSchema(appData.execSql);
        const nextNotes = (
          await defaultNotesPersistence.listNotes(appData.execSql)
        )
          .filter(isNoteSummary)
          .sort(compareNoteSummaries);

        if (cancelled) {
          return;
        }

        setNotes(nextNotes);
        setReady(true);
        setSelectedNoteId((currentNoteId) => {
          const latestExplicitSelection = explicitSelectionRef.current;
          if (latestExplicitSelection) {
            return latestExplicitSelection.noteId;
          }
          if (
            currentNoteId &&
            (currentNoteId === DEFAULT_NOTE_ID ||
              nextNotes.some((note) => note.id === currentNoteId))
          ) {
            return currentNoteId;
          }

          return nextNotes[0]?.id ?? DEFAULT_NOTE_ID;
        });
      } catch (error) {
        if (!cancelled) {
          appData.logError("Notes: failed to load notes.", error);
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appData.dbStatus, appData.execSql, appData.logError]);

  useEffect(() => {
    return subscribeToPersistedDocuments(appData.domainScope, (document) => {
      if (!isNoteSummary(document)) {
        return;
      }

      setNotes((currentNotes) => mergeNoteSummary(currentNotes, document));
      setSelectedNoteId((currentNoteId) => currentNoteId ?? document.id);
    });
  }, [appData.domainScope]);

  const createNote = useCallback(() => {
    const noteId = crypto.randomUUID();
    const nextNote: DocumentSummary = {
      id: noteId,
      containerId: appData.containerId,
      documentKind: "note",
      documentId: null,
      title: getUntitledDocumentTitle("note"),
      updatedAt: new Date().toISOString(),
    };

    setNotes((currentNotes) => mergeNoteSummary(currentNotes, nextNote));
    setSelectedNoteId(noteId);
  }, [appData.containerId]);

  return {
    createNote,
    notes,
    ready,
    selectedNoteId,
    selectNote: setSelectedNoteId,
  };
}

function useActiveNoteSelection(input: {
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

function NotesEmptyState() {
  return <div className="notes notes--empty">Loading notes...</div>;
}

function NotesApp(props: NotesAppProps) {
  const { setSidebar } = useWindowSidebar();
  const explicitSelection = useExplicitNoteSelection(props);
  const { createNote, notes, ready, selectedNoteId, selectNote } =
    useNotesDirectory(explicitSelection);
  const activeSelection = useActiveNoteSelection({
    explicitSelection,
    notes,
    selectedNoteId,
  });

  useEffect(() => {
    setSidebar(
      <NotesSidebar
        createNote={createNote}
        notes={notes}
        ready={ready}
        selectNote={selectNote}
        selectedNoteId={selectedNoteId}
      />,
    );

    return () => setSidebar(null);
  }, [createNote, notes, ready, selectNote, selectedNoteId, setSidebar]);

  if (!activeSelection) {
    return <NotesEmptyState />;
  }

  return (
    <NotesProvider
      noteId={activeSelection.noteId}
      {...(activeSelection.containerId === undefined
        ? {}
        : { containerId: activeSelection.containerId })}
      {...(activeSelection.documentId === undefined
        ? {}
        : { documentId: activeSelection.documentId })}
    >
      <Notes />
    </NotesProvider>
  );
}
