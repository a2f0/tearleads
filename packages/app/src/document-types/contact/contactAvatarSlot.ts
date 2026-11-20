import type { DocumentSnapshot } from "@tearleads/client-sdk";
import { findAvatarCrop, findDocumentAvatar } from "../shared/documentPhotos";
import { CONTACT_PHOTOS } from "./contactDocumentDefinition";

export interface ContactAvatarRef {
  byteLength: number;
  mimeType: string | null;
  // Null while the blob has not been hydrated locally yet (e.g. an avatar set
  // on another device that is still downloading).
  storageKey: string | null;
}

export function getContactAvatarRef(
  snapshot: Pick<
    DocumentSnapshot,
    "attachments" | "attachmentStorageKeyBySlotId" | "structuredFields"
  >,
): ContactAvatarRef | null {
  const photo = findDocumentAvatar(CONTACT_PHOTOS, snapshot);
  const attachment =
    photo && (findAvatarCrop(snapshot.attachments, photo) ?? photo);
  if (!attachment) {
    return null;
  }

  return {
    byteLength: attachment.byteLength,
    mimeType: attachment.mimeType,
    storageKey:
      snapshot.attachmentStorageKeyBySlotId[attachment.slotId] ?? null,
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
