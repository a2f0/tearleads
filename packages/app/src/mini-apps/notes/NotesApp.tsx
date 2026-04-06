import { Notes } from "./Notes";
import { DEFAULT_NOTE_ID, NotesProvider } from "./NotesProvider";
import type { NoteSummary } from "./notesPersistence";

interface NotesAppProps {
  noteId?: string;
  containerId?: string | null;
  onPersistedNote?: (note: NoteSummary) => void;
}

export function createNotesWindowComponent({
  noteId = DEFAULT_NOTE_ID,
  containerId,
  onPersistedNote,
}: NotesAppProps = {}) {
  function NotesWindowComponent() {
    return (
      <NotesApp
        noteId={noteId}
        {...(containerId === undefined ? {} : { containerId })}
        {...(onPersistedNote === undefined ? {} : { onPersistedNote })}
      />
    );
  }

  NotesWindowComponent.displayName = `NotesWindow(${noteId})`;
  return NotesWindowComponent;
}

export function NotesApp({
  noteId = DEFAULT_NOTE_ID,
  containerId,
  onPersistedNote,
}: NotesAppProps) {
  return (
    <NotesProvider
      noteId={noteId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(onPersistedNote === undefined ? {} : { onPersistedNote })}
    >
      <Notes />
    </NotesProvider>
  );
}
