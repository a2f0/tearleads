import { useCallback } from "react";
import { useLog } from "../../providers/logging/LogProvider";
import {
  type DocumentAttachmentUpload,
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
