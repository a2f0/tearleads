import type { DocumentAttachment } from "@tearleads/client-sdk";
import { MiniAppImageViewer } from "../../components/mini-app/MiniAppLayout";
import { getAttachmentFileType } from "../shared/attachmentFileType";
import { NoteAttachmentPreview } from "./NoteAttachmentPreview";

/**
 * The overlay an opened attachment gets, chosen by what the attachment is.
 *
 * An image goes to the shared full-screen viewer — the same one the blob browser
 * opens — because an image is the attachment worth looking at closely, and only
 * that viewer lets a phone pinch, pan, and zoom it. Everything else keeps the
 * panel preview, which is the surface that can draw a type icon, a size, and
 * "no preview available" for a file nothing here can render. An image whose
 * bytes have not arrived yet has no URL to hand the viewer, so it lands there
 * too and the panel says as much.
 *
 * Remove is deliberately absent from the image viewer: staging a removal opens
 * the confirmation dialog, which the full-screen overlay would sit on top of.
 * The tile's own trash control stays the way out — visible at rest on touch, on
 * hover or focus elsewhere.
 */
export function NoteAttachmentOverlay({
  attachment,
  canRemove,
  imageUrl,
  onClose,
  onDownload,
  onRemove,
}: {
  attachment: DocumentAttachment;
  canRemove: boolean;
  imageUrl: string | undefined;
  onClose: () => void;
  onDownload: (slotId: string) => void;
  onRemove: (slotId: string) => void;
}) {
  const isImage = getAttachmentFileType({
    mimeType: attachment.mimeType,
    name: attachment.name,
  }).isImage;

  if (isImage && imageUrl) {
    return (
      <MiniAppImageViewer
        label={attachment.name}
        onClose={onClose}
        onDownload={() => onDownload(attachment.slotId)}
        url={imageUrl}
      />
    );
  }

  return (
    <NoteAttachmentPreview
      attachment={attachment}
      canRemove={canRemove}
      imageUrl={imageUrl}
      onClose={onClose}
      onDownload={onDownload}
      onRemove={onRemove}
    />
  );
}
