import type { BlobInfo, BlobStore } from "@symcrypt/client-sdk";
import { useCallback } from "react";
import { useLog } from "../../providers/logging/LogProvider";
import {
  type DocumentAttachmentUpload,
  readBlobDocumentAttachmentUpload,
  readDocumentAttachmentUpload,
} from "./documentAttachmentUtils";

export function useDocumentAttachmentSelection(params: {
  errorMessage: string;
  replaceAttachment: (
    slotId: string,
    attachment: DocumentAttachmentUpload,
  ) => void;
}) {
  const { errorMessage, replaceAttachment } = params;
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

        replaceAttachment(slotId, await readDocumentAttachmentUpload(file));
      } catch (error) {
        logError(errorMessage, error);
      }
    },
    [errorMessage, logError, replaceAttachment],
  );
}

export function useDocumentBlobAttachmentSelection(params: {
  blobStore: BlobStore;
  errorMessage: string;
  replaceAttachment: (
    slotId: string,
    attachment: DocumentAttachmentUpload,
  ) => void;
}) {
  const { blobStore, errorMessage, replaceAttachment } = params;
  const { logError } = useLog();

  return useCallback(
    async (slotId: string, blob: BlobInfo) => {
      try {
        replaceAttachment(
          slotId,
          await readBlobDocumentAttachmentUpload({ blob, blobStore }),
        );
      } catch (error) {
        logError(errorMessage, error);
        throw error;
      }
    },
    [blobStore, errorMessage, logError, replaceAttachment],
  );
}
