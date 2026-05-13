import type { ReactNode } from "react";
import type {
  DocumentAttachmentStatus,
  DocumentAttachmentUpload,
} from "../../stores/documents/types";

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

export type NoteAttachmentStatus = DocumentAttachmentStatus;
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
