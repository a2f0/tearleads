import type { DocumentSnapshot } from "@tearleads/client-sdk";
import {
  type DocumentPhotoCapability,
  findAvatarCrop,
  findDocumentAvatar,
} from "../documentPhotos";

/** The blob a list row loads to show a document's avatar. */
export interface DocumentAvatarRef {
  byteLength: number;
  mimeType: string | null;
  // Null while the blob has not been hydrated locally yet (e.g. an avatar set
  // on another device that is still downloading).
  storageKey: string | null;
}

/** The chosen photo's square crop when it has one, else the photo itself. */
export function getDocumentAvatarRef(
  photos: DocumentPhotoCapability,
  snapshot: Pick<
    DocumentSnapshot,
    "attachments" | "attachmentStorageKeyBySlotId" | "structuredFields"
  >,
): DocumentAvatarRef | null {
  const photo = findDocumentAvatar(photos, snapshot);
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

export function sameDocumentAvatarRef(
  left: DocumentAvatarRef | null | undefined,
  right: DocumentAvatarRef | null | undefined,
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
