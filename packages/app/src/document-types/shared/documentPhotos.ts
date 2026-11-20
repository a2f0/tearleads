import type {
  DocumentAttachment,
  DocumentAttachmentUpload,
  DocumentSnapshot,
  DocumentStore,
} from "@tearleads/client-sdk";
import {
  getLatestDocumentAttachmentBySlotId,
  isImageDocumentAttachmentBlob,
} from "./documentAttachmentUtils";

export const AVATAR_PHOTO_FIELD = "avatarPhotoSlotId";

export interface DocumentPhotoCapability {
  readonly slotId: string;
  readonly avatar: boolean;
}

export function photoCollectionSlot(slotId: string) {
  return { slotId, label: "Photos", itemLabel: "Photo", multiple: true };
}

export function isDocumentPhoto(
  photos: DocumentPhotoCapability,
  attachment: DocumentAttachment,
) {
  return (
    attachment.slotId.startsWith(`${photos.slotId}:`) &&
    isImageDocumentAttachmentBlob(attachment)
  );
}

export function findDocumentAvatar(
  photos: DocumentPhotoCapability,
  snapshot: Pick<DocumentSnapshot, "attachments" | "structuredFields">,
) {
  const slotId = snapshot.structuredFields[AVATAR_PHOTO_FIELD];
  if (!photos.avatar || !slotId) return null;
  const photo = getLatestDocumentAttachmentBySlotId(
    snapshot.attachments,
    slotId,
  );
  return photo && isDocumentPhoto(photos, photo) ? photo : null;
}

function avatarCropSlotId(photoSlotId: string) {
  return `avatar-crop:${photoSlotId}`;
}

export function findAvatarCrop(
  attachments: readonly DocumentAttachment[],
  photo: DocumentAttachment,
) {
  const crop = getLatestDocumentAttachmentBySlotId(
    attachments,
    avatarCropSlotId(photo.slotId),
  );
  // Replacing a gallery photo invalidates a crop made from its previous bytes.
  return crop?.name === cropName(photo) && crop.mimeType === "image/png"
    ? crop
    : null;
}

function cropName(photo: DocumentAttachment) {
  return `${photo.contentSha256}.png`;
}

export type AvatarChoice =
  | { photo: DocumentAttachmentUpload; crop: Blob }
  | { slotId: string; crop?: { bytes: Blob; sourceDigest: string } }
  | null;

async function prepareAvatarPhoto(
  store: DocumentStore,
  photos: DocumentPhotoCapability,
  choice: NonNullable<AvatarChoice>,
  current: () => boolean,
): Promise<DocumentAttachment | null> {
  const slotId =
    "slotId" in choice
      ? choice.slotId
      : `${photos.slotId}:${crypto.randomUUID()}`;
  if ("photo" in choice) {
    if (
      !store.getSnapshot().canAttach ||
      !isImageDocumentAttachmentBlob(choice.photo)
    )
      return null;
    await store.replaceAttachment(slotId, choice.photo);
  }
  const photo = getLatestDocumentAttachmentBySlotId(
    store.getSnapshot().attachments,
    slotId,
  );
  if (!photo || !isDocumentPhoto(photos, photo) || !current()) return null;
  if ("slotId" in choice && !choice.crop) return photo;
  const crop = "photo" in choice ? choice.crop : choice.crop?.bytes;
  if (!crop || !store.getSnapshot().canAttach) return null;
  if ("slotId" in choice && choice.crop?.sourceDigest !== photo.contentSha256)
    return null;
  await store.replaceAttachment(avatarCropSlotId(slotId), {
    bytes: crop,
    mimeType: "image/png",
    name: cropName(photo),
  });
  return findAvatarCrop(store.getSnapshot().attachments, photo) ? photo : null;
}

// Both views can submit to the same document while an upload is staging.
const latestSelection = new WeakMap<DocumentStore, object>();

export async function selectDocumentAvatar(
  store: DocumentStore,
  kind: string,
  photos: DocumentPhotoCapability,
  choice: AvatarChoice,
  isCurrent: () => boolean = () => true,
) {
  const writable = () => {
    const snapshot = store.getSnapshot();
    return (
      isCurrent() &&
      snapshot.ready &&
      snapshot.canWrite &&
      snapshot.documentKind === kind
    );
  };
  if (!photos.avatar || !writable()) return;
  const intent = {};
  latestSelection.set(store, intent);
  const current = () => latestSelection.get(store) === intent && writable();
  const photo =
    choice && (await prepareAvatarPhoto(store, photos, choice, current));
  if (!current()) return;
  if (choice && !photo) throw new Error("Could not save the avatar photo.");
  const stillCurrent = () =>
    current() &&
    (!photo ||
      getLatestDocumentAttachmentBySlotId(
        store.getSnapshot().attachments,
        photo.slotId,
      )?.contentSha256 === photo.contentSha256);
  const slotId = photo?.slotId;
  await store.setStructuredFields(
    kind,
    { [AVATAR_PHOTO_FIELD]: slotId },
    { stillCurrent },
  );
  if (
    stillCurrent() &&
    (store.getSnapshot().structuredFields[AVATAR_PHOTO_FIELD] || undefined) !==
      slotId
  )
    throw new Error("Could not save the avatar selection.");
}

export function removeDocumentPhoto(
  store: DocumentStore,
  photos: DocumentPhotoCapability,
  slotId: string,
) {
  const snapshot = store.getSnapshot();
  if (!snapshot.canAttach || !snapshot.canWrite) return;
  const photo = getLatestDocumentAttachmentBySlotId(
    snapshot.attachments,
    slotId,
  );
  if (photo && isDocumentPhoto(photos, photo)) {
    if (snapshot.structuredFields[AVATAR_PHOTO_FIELD] === slotId) {
      void store.setStructuredFields(
        snapshot.documentKind,
        { [AVATAR_PHOTO_FIELD]: undefined },
        {
          stillCurrent: () =>
            store.getSnapshot().structuredFields[AVATAR_PHOTO_FIELD] === slotId,
        },
      );
    }
    const cropSlot = avatarCropSlotId(slotId);
    if (snapshot.attachments.some((item) => item.slotId === cropSlot))
      store.removeAttachment(cropSlot);
  }
  store.removeAttachment(slotId);
}
