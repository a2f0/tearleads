import type { DocumentAttachment } from "@tearleads/client-sdk";
import { MiniAppStatus } from "../../components/mini-app/MiniAppLayout";
import { useFileViewer } from "../../providers/file-viewer/FileViewerProvider";
import { useLog } from "../../providers/logging/LogProvider";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import { formatByteLength } from "../../utils/formatByteLength";
import type { getAttachmentFileType } from "../shared/attachmentFileType";
import {
  FileDocumentPdfPreviewPanel,
  isPdfMimeType,
  useFileDocumentPdfPreview,
} from "../shared/FileDocumentPdfPreview";
import { NOTE_DOCUMENT_LABELS } from "./noteDocumentLabels";

// Mount only for the opened attachment, so a note with several PDFs reads and
// renders just the selected file. Closing the overlay releases the viewer.
function NoteAttachmentPdfPreview({
  attachment,
  storageKey,
}: {
  attachment: DocumentAttachment;
  storageKey: string;
}) {
  const { infra } = useTearleadsRuntime();
  const { logError } = useLog();
  const fileViewer = useFileViewer();
  const preview = useFileDocumentPdfPreview({
    attachments: [attachment],
    attachmentStorageKeyBySlotId: { [attachment.slotId]: storageKey },
    blobStore: infra.blobStore,
    fileViewer,
    logError,
  });

  return preview ? <FileDocumentPdfPreviewPanel preview={preview} /> : null;
}

export function NoteAttachmentPreviewStage({
  attachment,
  fileType,
  imageUrl,
  storageKey,
}: {
  attachment: DocumentAttachment;
  fileType: ReturnType<typeof getAttachmentFileType>;
  imageUrl: string | undefined;
  storageKey: string | undefined;
}) {
  if (isPdfMimeType(attachment.mimeType)) {
    return (
      <div className="note-attachment-preview-stage note-attachment-preview-stage--pdf">
        {storageKey ? (
          <NoteAttachmentPdfPreview
            key={storageKey}
            attachment={attachment}
            storageKey={storageKey}
          />
        ) : (
          <MiniAppStatus>
            PDF preview is waiting for local content.
          </MiniAppStatus>
        )}
      </div>
    );
  }

  const { Icon } = fileType;
  return (
    <div className="note-attachment-preview-stage">
      {fileType.isImage && imageUrl ? (
        <img
          className="note-attachment-preview-image"
          src={imageUrl}
          alt={attachment.name}
        />
      ) : (
        <div className="note-attachment-preview-placeholder">
          <Icon aria-hidden size={64} weight="thin" />
          <span className="note-attachment-preview-placeholder-kind">
            {fileType.kind}
          </span>
          <span className="note-attachment-preview-placeholder-size">
            {formatByteLength(attachment.byteLength)}
          </span>
          <span className="note-attachment-preview-placeholder-hint">
            {NOTE_DOCUMENT_LABELS.previewNoPreview}
          </span>
        </div>
      )}
    </div>
  );
}
