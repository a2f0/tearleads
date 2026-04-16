import { Notes } from "./Notes";
import type { NoteSummary } from "./notesPersistence";
import { DEFAULT_NOTE_ID, NotesProvider } from "./providers/NotesProvider";

interface NotesAppProps {
  noteId?: string;
  containerId?: string | null;
  documentId?: string | null;
  onPersistedNote?: (note: NoteSummary) => void;
}

export function createNotesWindowComponent({
  noteId = DEFAULT_NOTE_ID,
  containerId,
  documentId,
  onPersistedNote,
}: NotesAppProps = {}) {
  function NotesWindowComponent() {
    return (
      <NotesApp
        noteId={noteId}
        {...(containerId === undefined ? {} : { containerId })}
        {...(documentId === undefined ? {} : { documentId })}
        {...(onPersistedNote === undefined ? {} : { onPersistedNote })}
      />
    );
  }

  NotesWindowComponent.displayName = `NotesWindow(${noteId})`;
  return NotesWindowComponent;
}

function NotesApp({
  noteId = DEFAULT_NOTE_ID,
  containerId,
  documentId,
  onPersistedNote,
}: NotesAppProps) {
  return (
    <NotesProvider
      noteId={noteId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      {...(onPersistedNote === undefined ? {} : { onPersistedNote })}
    >
      <Notes />
    </NotesProvider>
  );
}
