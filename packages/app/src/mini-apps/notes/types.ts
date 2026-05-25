import type {
  DocumentAttachmentStatus,
  DocumentAttachmentUpload,
} from "@tearleads/client-sdk";
import type { ReactNode } from "react";

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
  Record<string, DocumentAttachmentStatus>
>;
export type NotesAttachFiles = (
  files: ReadonlyArray<DocumentAttachmentUpload>,
) => void;
export type NotesHandleSelectedFiles = (
  fileList: FileList | null,
) => Promise<void>;
export type NotesSetSidebar = (sidebar: ReactNode | null) => void;
