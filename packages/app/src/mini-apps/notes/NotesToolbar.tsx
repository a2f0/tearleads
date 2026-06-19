import type { RefObject } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../components/shared/MiniAppLayout";
import { getNotesToolbarStatusLabel, NOTES_LABELS } from "./labels";

interface NotesToolbarProps {
  canAttach: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  isAuthenticated: boolean;
  online: boolean;
  ready: boolean;
}

export function NotesToolbar({
  canAttach,
  fileInputRef,
  isAuthenticated,
  online,
  ready,
}: NotesToolbarProps) {
  return (
    <MiniAppToolbar className="notes-toolbar">
      <MiniAppButton
        onClick={() => fileInputRef.current?.click()}
        disabled={!ready || !canAttach}
      >
        {NOTES_LABELS.attachButton}
      </MiniAppButton>
      <MiniAppStatus as="span">
        {getNotesToolbarStatusLabel({ canAttach, isAuthenticated, online })}
      </MiniAppStatus>
    </MiniAppToolbar>
  );
}
