import { NotesAttachmentsPanel } from "./attachments/NotesAttachmentsPanel";
import { useNotesModel } from "./hooks/useNotesModel";
import { NotesEditor } from "./NotesEditor";
import { NotesToolbar } from "./NotesToolbar";
import "./Notes.css";

export function Notes() {
  const model = useNotesModel();

  return (
    <div className="notes">
      <NotesToolbar
        canAttach={model.canAttach}
        fileInputId={model.fileInputId}
        fileInputRef={model.fileInputRef}
        handleSelectedFiles={model.handleSelectedFiles}
        isAuthenticated={model.isAuthenticated}
        online={model.online}
        ready={model.ready}
      />
      <NotesAttachmentsPanel
        attachments={model.attachments}
        attachmentStatusBySlotId={model.attachmentStatusBySlotId}
        canAttach={model.canAttach}
        dragActive={model.dragActive}
        fileInputId={model.fileInputId}
        handleDragEnter={model.handleDragEnter}
        handleDragLeave={model.handleDragLeave}
        handleDragOver={model.handleDragOver}
        handleDrop={model.handleDrop}
        imageUrlBySlotId={model.imageUrlBySlotId}
      />
      <NotesEditor
        ready={model.ready}
        setText={model.setText}
        syncing={model.syncing}
        text={model.text}
      />
    </div>
  );
}
