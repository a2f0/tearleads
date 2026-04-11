import type { PropsWithChildren } from "react";
import {
  createDocumentStore,
  DEFAULT_DOCUMENT_ID,
  type DocumentAttachmentStatus,
  type DocumentContextValue,
  DocumentsProvider,
  type DocumentsRuntime,
  primeDocumentStore,
  useDocument,
} from "../../data/documents/DocumentsProvider";
import type { NoteSummary, NotesPersistence } from "./notesPersistence";
import { adaptNotesPersistence } from "./notesPersistence";

export const DEFAULT_NOTE_ID = DEFAULT_DOCUMENT_ID;

export type NoteAttachmentStatus = DocumentAttachmentStatus;
export type NotesRuntime = DocumentsRuntime;

export function createNotesStore(
  noteId: string,
  initialRuntime: NotesRuntime,
  persistence?: NotesPersistence,
  onPersistedNote?: (note: NoteSummary) => void,
  initialDocumentId: string | null = null,
  initialText = "",
): ReturnType<typeof createDocumentStore> {
  return createDocumentStore(
    noteId,
    initialRuntime,
    persistence ? adaptNotesPersistence(persistence) : undefined,
    onPersistedNote,
    initialDocumentId,
    initialText,
  );
}

export function primeNotesStore(
  domainScope: object,
  noteId: string,
  runtime: NotesRuntime,
  ...rest: Parameters<typeof primeDocumentStore> extends [
    object,
    string,
    NotesRuntime,
    ...infer Tail,
  ]
    ? Tail
    : never
): ReturnType<typeof primeDocumentStore> {
  return primeDocumentStore(domainScope, noteId, runtime, ...rest);
}

interface NotesProviderProps extends PropsWithChildren {
  noteId?: string;
  containerId?: string | null;
  documentId?: string | null;
  onPersistedNote?: (note: NoteSummary) => void;
}

export function NotesProvider({
  children,
  noteId = DEFAULT_NOTE_ID,
  containerId,
  documentId,
  onPersistedNote,
}: NotesProviderProps) {
  return (
    <DocumentsProvider
      localId={noteId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
      {...(onPersistedNote === undefined
        ? {}
        : { onPersistedDocument: onPersistedNote })}
    >
      {children}
    </DocumentsProvider>
  );
}

export function useNotes(): DocumentContextValue {
  return useDocument();
}
