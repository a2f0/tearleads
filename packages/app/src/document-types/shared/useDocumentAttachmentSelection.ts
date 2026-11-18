import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useLog } from "../../providers/logging/LogProvider";
import {
  type DocumentAttachmentSlot,
  type DocumentAttachmentUpload,
  readBlobDocumentAttachmentUpload,
  readDocumentAttachmentUpload,
  resolveAttachmentUploadSlot,
} from "./documentAttachmentUtils";

export function useDocumentAttachmentSelection(params: {
  errorMessage: string;
  slots?: ReadonlyArray<DocumentAttachmentSlot>;
  replaceAttachment: (
    slotId: string,
    attachment: DocumentAttachmentUpload,
  ) => void | Promise<void>;
}) {
  const { errorMessage, replaceAttachment, slots } = params;
  const { logError } = useLog();

  return useCallback(
    async (slotId: string, fileList: FileList | null) => {
      try {
        if (!fileList || fileList.length === 0) {
          return;
        }

        const multiple = slots?.some(
          (slot) => slot.slotId === slotId && slot.multiple,
        );
        for (const file of Array.from(fileList).slice(
          0,
          multiple ? undefined : 1,
        )) {
          await replaceAttachment(
            resolveAttachmentUploadSlot(slotId, slots ?? []),
            await readDocumentAttachmentUpload(file),
          );
        }
      } catch (error) {
        logError(errorMessage, error);
      }
    },
    [errorMessage, logError, replaceAttachment, slots],
  );
}

export function useDocumentBlobAttachmentSelection(params: {
  blobStore: BlobStore;
  errorMessage: string;
  replaceAttachment: (
    slotId: string,
    attachment: DocumentAttachmentUpload,
  ) => void | Promise<void>;
}) {
  const { blobStore, errorMessage, replaceAttachment } = params;
  const { logError } = useLog();

  return useCallback(
    async (slotId: string, blob: BlobInfo) => {
      try {
        await replaceAttachment(
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
