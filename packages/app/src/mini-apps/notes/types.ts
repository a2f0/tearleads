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

export type NotesSetSidebar = (sidebar: ReactNode | null) => void;
