import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useLog } from "../../providers/logging/LogProvider";
import {
  type DocumentAttachmentUpload,
  readBlobDocumentAttachmentUpload,
  readDocumentAttachmentUpload,
} from "./documentAttachmentUtils";

export function useDocumentAttachmentSelection(params: {
  errorMessage: string;
  setAttachment: (slotId: string, attachment: DocumentAttachmentUpload) => void;
}) {
  const { errorMessage, setAttachment } = params;
  const { logError } = useLog();

  return useCallback(
    async (slotId: string, fileList: FileList | null) => {
      try {
        if (!fileList || fileList.length === 0) {
          return;
        }

        const [file] = Array.from(fileList);
        if (!file) {
          return;
        }

        setAttachment(slotId, await readDocumentAttachmentUpload(file));
      } catch (error) {
        logError(errorMessage, error);
      }
    },
    [errorMessage, logError, setAttachment],
  );
}

export function useDocumentBlobAttachmentSelection(params: {
  blobStore: BlobStore;
  errorMessage: string;
  setAttachment: (slotId: string, attachment: DocumentAttachmentUpload) => void;
}) {
  const { blobStore, errorMessage, setAttachment } = params;
  const { logError } = useLog();

  return useCallback(
    async (slotId: string, blob: BlobInfo) => {
      try {
        setAttachment(
          slotId,
          await readBlobDocumentAttachmentUpload({ blob, blobStore }),
        );
      } catch (error) {
        logError(errorMessage, error);
        throw error;
      }
    },
    [blobStore, errorMessage, logError, setAttachment],
  );
}
