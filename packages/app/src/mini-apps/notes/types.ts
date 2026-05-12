import type { ReactNode } from "react";
import type { DocumentAttachmentUpload } from "../../stores/documents/types";
import type { NoteAttachmentStatus } from "../../stores/notes/NotesProvider";

export interface NotesAppProps {
  noteId?: string;
  containerId?: string | null;
  documentId?: string | null;
}

export interface ActiveNoteSelection {
  noteId: string;
  containerId?: string | null;
  documentId?: string | null;
}

export type AttachmentImageUrlBySlotId = Readonly<Record<string, string>>;
export type AttachmentStatusBySlotId = Readonly<
  Record<string, NoteAttachmentStatus>
>;
export type NotesAttachmentUpload = DocumentAttachmentUpload;
export type NotesAttachFiles = (
  files: ReadonlyArray<NotesAttachmentUpload>,
) => void;
export type NotesHandleSelectedFiles = (
  fileList: FileList | null,
) => Promise<void>;
export type NotesSetSidebar = (sidebar: ReactNode | null) => void;
