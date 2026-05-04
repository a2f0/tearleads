import {
  DEFAULT_NOTE_ID,
  NotesProvider,
} from "../../stores/notes/NotesProvider";
import { Notes } from "./Notes";

interface NotesAppProps {
  noteId?: string;
  containerId?: string | null;
  documentId?: string | null;
}

export function createNotesWindowComponent({
  noteId = DEFAULT_NOTE_ID,
  containerId,
  documentId,
}: NotesAppProps = {}) {
  function NotesWindowComponent() {
    return (
      <NotesApp
        noteId={noteId}
        {...(containerId === undefined ? {} : { containerId })}
        {...(documentId === undefined ? {} : { documentId })}
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
}: NotesAppProps) {
  return (
    <NotesProvider
      noteId={noteId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
    >
      <Notes />
    </NotesProvider>
  );
}
