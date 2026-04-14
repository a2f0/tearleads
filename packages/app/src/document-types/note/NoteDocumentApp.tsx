import { NotesApp } from "../../mini-apps/notes/NotesApp";
import type { DocumentTypeAppProps } from "../types";

export function NoteDocumentApp({
  containerId,
  documentId,
  localId,
  onPersistedDocument,
}: DocumentTypeAppProps) {
  return (
    <NotesApp
      {...(localId === undefined ? {} : { noteId: localId })}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      {...(onPersistedDocument === undefined
        ? {}
        : {
            onPersistedNote(note) {
              onPersistedDocument(note);
            },
          })}
    />
  );
}
