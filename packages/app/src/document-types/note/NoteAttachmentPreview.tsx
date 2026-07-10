import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { DocumentAttachment } from "@tearleads/client-sdk";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import {
  MiniAppModalBackdrop,
  MiniAppModalPanel,
} from "../../components/shared/MiniAppLayout";
import { formatByteLength } from "../../utils/formatByteLength";
import { getAttachmentFileType } from "../shared/attachmentFileType";
import { NOTE_DOCUMENT_LABELS } from "./noteDocumentLabels";

interface NoteAttachmentPreviewProps {
  attachment: DocumentAttachment;
  canRemove: boolean;
  imageUrl: string | undefined;
  onClose: () => void;
  onDownload: (slotId: string) => void;
  onRemove: (slotId: string) => void;
}

// An enlarged look at a single attachment, opened from a tile. Images fill the
// stage; everything else shows its type icon, name, kind and size. The stage's
// own toolbar carries the download / remove / close actions so the note body
// stays uncluttered. Rendered through a portal into <body> so it overlays the
// whole window rather than being clipped by the note's scroll container, and
// closes on Escape or a backdrop click like the app's other modals.
export function NoteAttachmentPreview({
  attachment,
  canRemove,
  imageUrl,
  onClose,
  onDownload,
  onRemove,
}: NoteAttachmentPreviewProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fileType = getAttachmentFileType({
    mimeType: attachment.mimeType,
    name: attachment.name,
  });
  const { Icon } = fileType;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return createPortal(
    <MiniAppModalBackdrop
      className="note-attachment-preview-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <MiniAppModalPanel
        className="note-attachment-preview-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="note-attachment-preview-bar">
          <div className="note-attachment-preview-heading">
            <Icon aria-hidden size={18} />
            <span
              id={titleId}
              className="note-attachment-preview-title"
              title={attachment.name}
            >
              {attachment.name}
            </span>
          </div>
          <div className="note-attachment-preview-actions">
            <button
              type="button"
              className="note-attachment-preview-button"
              onClick={() => onDownload(attachment.slotId)}
              title={NOTE_DOCUMENT_LABELS.downloadAttachment(attachment.name)}
              aria-label={NOTE_DOCUMENT_LABELS.downloadAttachment(
                attachment.name,
              )}
            >
              <DownloadSimpleIcon aria-hidden size={16} />
            </button>
            {canRemove ? (
              <button
                type="button"
                className="note-attachment-preview-button"
                onClick={() => {
                  onRemove(attachment.slotId);
                  onClose();
                }}
                title={NOTE_DOCUMENT_LABELS.removeAttachment(attachment.name)}
                aria-label={NOTE_DOCUMENT_LABELS.removeAttachment(
                  attachment.name,
                )}
              >
                <TrashIcon aria-hidden size={16} />
              </button>
            ) : null}
            <button
              type="button"
              className="note-attachment-preview-button"
              onClick={onClose}
              ref={closeButtonRef}
              title={NOTE_DOCUMENT_LABELS.previewClose}
              aria-label={NOTE_DOCUMENT_LABELS.previewClose}
            >
              <XIcon aria-hidden size={16} />
            </button>
          </div>
        </div>
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
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>,
    document.body,
  );
}
