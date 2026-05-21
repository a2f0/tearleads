import type { ChangeEvent, RefObject } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../components/shared/MiniAppLayout";
import { getNotesToolbarStatusLabel, NOTES_LABELS } from "./labels";
import type { NotesHandleSelectedFiles } from "./types";

interface NotesToolbarProps {
  canAttach: boolean;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleSelectedFiles: NotesHandleSelectedFiles;
  isAuthenticated: boolean;
  online: boolean;
  ready: boolean;
}

export function NotesToolbar({
  canAttach,
  fileInputId,
  fileInputRef,
  handleSelectedFiles,
  isAuthenticated,
  online,
  ready,
}: NotesToolbarProps) {
  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    void handleSelectedFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  }

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
      <input
        id={fileInputId}
        ref={fileInputRef}
        className="notes-file-input"
        type="file"
        multiple
        disabled={!ready || !canAttach}
        onChange={handleInputChange}
      />
    </MiniAppToolbar>
  );
}
