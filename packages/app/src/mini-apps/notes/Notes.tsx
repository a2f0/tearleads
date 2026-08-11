import { useCallback } from "react";
import { MiniAppRoot } from "../../components/mini-app/MiniAppLayout";
import { useWindowRefreshMenuItem } from "../../components/window/WindowMenuContext";
import { NoteEditorFields } from "../../document-types/note/NoteEditorFields";
import { useNoteEditorFields } from "../../document-types/note/useNoteEditorFields";
import { useDocument } from "../../stores/documents/DocumentsProvider";
import "./Notes.css";

export function Notes({
  containerId = null,
  localId,
  registerRefreshMenuItem = false,
}: {
  containerId?: string | null;
  localId?: string | undefined;
  registerRefreshMenuItem?: boolean;
}) {
  const { requestSync } = useDocument();
  // The optional container/local ids wire the note editor's blob picker to the
  // active note; the standalone list home omits them and the "Select Blob"
  // control stays hidden.
  const model = useNoteEditorFields({
    containerId,
    ...(localId === undefined ? {} : { localId }),
  });
  const handleRefresh = useCallback(() => {
    requestSync();
  }, [requestSync]);

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
