import type { ChangeEvent, RefObject } from "react";
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
    <div className="notes-toolbar">
      <button
        type="button"
        className="notes-attach-button"
        onClick={() => fileInputRef.current?.click()}
        disabled={!ready || !canAttach}
      >
        {NOTES_LABELS.attachButton}
      </button>
      <span className="notes-toolbar-status">
        {getNotesToolbarStatusLabel({ canAttach, isAuthenticated, online })}
      </span>
      <input
        id={fileInputId}
        ref={fileInputRef}
        className="notes-file-input"
        type="file"
        multiple
        disabled={!ready || !canAttach}
        onChange={handleInputChange}
      />
    </div>
  );
}
