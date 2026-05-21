import { useCallback } from "react";
import { MiniAppRoot } from "../../components/shared/MiniAppLayout";
import { useWindowRefreshMenuItem } from "../../components/window/WindowMenuContext";
import { NotesAttachmentsPanel } from "./attachments/NotesAttachmentsPanel";
import { useNotesModel } from "./hooks/useNotesModel";
import { NotesEditor } from "./NotesEditor";
import { NotesToolbar } from "./NotesToolbar";
import "./Notes.css";

export function Notes({
  registerRefreshMenuItem = false,
}: {
  registerRefreshMenuItem?: boolean;
}) {
  const model = useNotesModel();
  const handleRefresh = useCallback(() => {
    model.requestSync();
  }, [model.requestSync]);

  useWindowRefreshMenuItem(
    registerRefreshMenuItem
      ? {
          disabled: !model.ready || model.syncing,
          onRefresh: handleRefresh,
          refreshing: model.syncing,
        }
      : null,
  );

  return (
    <MiniAppRoot padding="none">
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
    </MiniAppRoot>
  );
}
