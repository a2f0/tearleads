import type { ChangeEvent, RefObject } from "react";
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
        Attach File
      </button>
      <span className="notes-toolbar-status">
        {canAttach
          ? isAuthenticated && online
            ? "Drop files into the note to attach them."
            : "Attachments save locally and sync when you're online."
          : "Attachments require a local key package."}
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
