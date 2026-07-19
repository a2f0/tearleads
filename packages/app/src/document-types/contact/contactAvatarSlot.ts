import type { DocumentAttachment } from "@tearleads/client-sdk";
import { getLatestDocumentAttachmentBySlotId } from "../shared/documentAttachmentUtils";

// The contact avatar is a single attachment slot on the contact document. The
// bound blob is the already-cropped square image (the editor persists the crop
// result, not the original photo), so consumers can render it directly inside
// a circle without any transform metadata.
export const CONTACT_AVATAR_SLOT_ID = "contact-avatar";
export const CONTACT_AVATAR_ATTACHMENT_NAME = "avatar.png";
export const CONTACT_AVATAR_MIME_TYPE = "image/png";

export interface ContactAvatarRef {
  byteLength: number;
  mimeType: string | null;
  // Null while the blob has not been hydrated locally yet (e.g. an avatar set
  // on another device that is still downloading).
  storageKey: string | null;
}

export function getContactAvatarRef(
  attachments: ReadonlyArray<DocumentAttachment>,
  attachmentStorageKeyBySlotId: Readonly<Record<string, string>>,
): ContactAvatarRef | null {
  const attachment = getLatestDocumentAttachmentBySlotId(
    attachments,
    CONTACT_AVATAR_SLOT_ID,
  );
  if (!attachment) {
    return null;
  }

  return {
    byteLength: attachment.byteLength,
    mimeType: attachment.mimeType,
    storageKey: attachmentStorageKeyBySlotId[CONTACT_AVATAR_SLOT_ID] ?? null,
  };
}

export function sameContactAvatarRef(
  left: ContactAvatarRef | null | undefined,
  right: ContactAvatarRef | null | undefined,
): boolean {
  if (!left || !right) {
    return !left === !right;
  }

  return (
    left.byteLength === right.byteLength &&
    left.mimeType === right.mimeType &&
    left.storageKey === right.storageKey
  );
}
