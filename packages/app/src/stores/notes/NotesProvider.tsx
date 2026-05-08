import type { PropsWithChildren } from "react";
import {
  adaptNotesPersistence,
  type NotesPersistence,
} from "../../workflows/notes";
import {
  createDocumentStore,
  DEFAULT_DOCUMENT_ID,
  type DocumentAttachmentStatus,
  type DocumentContextValue,
  DocumentsProvider,
  type DocumentsRuntime,
  primeDocumentStore,
  useDocument,
} from "../documents/DocumentsProvider";

export const DEFAULT_NOTE_ID = DEFAULT_DOCUMENT_ID;

export type NoteAttachmentStatus = DocumentAttachmentStatus;
export type NotesRuntime = DocumentsRuntime;

export function createNotesStore(
  noteId: string,
  initialRuntime: NotesRuntime,
  persistence?: NotesPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
): ReturnType<typeof createDocumentStore> {
  return createDocumentStore(
    noteId,
    initialRuntime,
    persistence ? adaptNotesPersistence(persistence) : undefined,
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
}

export function NotesProvider({
  children,
  noteId = DEFAULT_NOTE_ID,
  containerId,
  documentId,
}: NotesProviderProps) {
  return (
    <DocumentsProvider
      localId={noteId}
      {...(containerId === undefined ? {} : { containerId })}
      {...(documentId === undefined ? {} : { documentId })}
    >
      {children}
    </DocumentsProvider>
  );
}

export function useNotes(): DocumentContextValue {
  return useDocument();
}
