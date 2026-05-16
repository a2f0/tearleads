import { useId, useMemo, useRef } from "react";
import { useAttachmentImageUrls } from "../../../document-types/shared/useAttachmentImageUrls";
import { useAppData } from "../../../providers/data/AppDataProvider";
import { useDocument } from "../../../stores/documents/DocumentsProvider";
import { useAttachmentDropzone } from "../attachments/useAttachmentDropzone";
import { createNotesFileHandlers } from "./useNotesFileHandlers";

export function useNotesModel() {
  const { blobStore, isAuthenticated, online } = useAppData();
  const {
    attachments,
    attachmentStatusBySlotId,
    attachmentStorageKeyBySlotId,
    attachFiles,
    canAttach,
    ready,
    requestSync,
    setText,
    syncing,
    text,
  } = useDocument();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const imageUrlBySlotId = useAttachmentImageUrls(
    attachments,
    attachmentStorageKeyBySlotId,
    blobStore,
  );
  const { handleSelectedFiles } = useMemo(
    () => createNotesFileHandlers({ attachFiles }),
    [attachFiles],
  );
  const dropzoneState = useAttachmentDropzone(canAttach, handleSelectedFiles);

  return {
    attachments,
    attachmentStatusBySlotId,
    canAttach,
    fileInputId,
    fileInputRef,
    handleSelectedFiles,
    imageUrlBySlotId,
    isAuthenticated,
    online,
    ready,
    requestSync,
    setText,
    syncing,
    text,
    ...dropzoneState,
  };
}
