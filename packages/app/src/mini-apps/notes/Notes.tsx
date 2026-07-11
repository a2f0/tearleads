import { useCallback } from "react";
import { MiniAppRoot } from "../../components/shared/MiniAppLayout";
import { useWindowRefreshMenuItem } from "../../components/window/WindowMenuContext";
import { NoteEditorFields } from "../../document-types/note/NoteEditorFields";
import { useNotesModel } from "./hooks/useNotesModel";
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
      <NoteEditorFields
        attachments={model.attachments}
        attachmentStatusBySlotId={model.attachmentStatusBySlotId}
        canAttach={model.canAttach}
        dragActive={model.dragActive}
        fileInputId={model.fileInputId}
        fileInputRef={model.fileInputRef}
        handleDownloadAttachment={model.handleDownloadAttachment}
        handleDragEnter={model.handleDragEnter}
        handleDragLeave={model.handleDragLeave}
        handleDragOver={model.handleDragOver}
        handleDrop={model.handleDrop}
        handleRemoveAttachment={model.handleRemoveAttachment}
        handleSelectBlob={model.handleSelectBlob}
        handleSelectedFiles={model.handleSelectedFiles}
        imageUrlBySlotId={model.imageUrlBySlotId}
        ready={model.ready}
        readOnly={model.readOnly}
        setText={model.setText}
        syncing={model.syncing}
        text={model.text}
      />
    </MiniAppRoot>
  );
}
