import type { BlobStore } from "@tearleads/client-sdk";
import { useContext, useLayoutEffect, useMemo } from "react";
import {
  DocumentContext,
  DocumentWriteScopeContext,
  useDocument,
} from "../../stores/documents/DocumentsProvider";
import type { AppDocumentProjectorDefinition } from "../types";
import { DocumentAvatarControl } from "./DocumentAvatarControl";
import { isAutomaticBlobPreviewAllowed } from "./documentAttachmentUtils";
import {
  findAvatarCrop,
  findDocumentAvatar,
  isDocumentPhoto,
  selectDocumentAvatar,
} from "./documentPhotos";

export function DocumentAvatar({
  definition,
  displayName,
  isEditing,
  imageUrlBySlotId,
  blobStore,
}: {
  definition: AppDocumentProjectorDefinition;
  displayName: string;
  isEditing: boolean;
  imageUrlBySlotId: Readonly<Record<string, string | undefined>>;
  blobStore: BlobStore;
}) {
  const snapshot = useDocument();
  const store = useContext(DocumentContext);
  const scope = useContext(DocumentWriteScopeContext);
  const writable = snapshot.ready && snapshot.canWrite && snapshot.canAttach;
  const canEdit = writable && isEditing;
  // The camera, crop dialog, and queued selection belong to this writable view.
  const lifetime = useMemo(
    () => ({ active: false, store, scope, writable, key: crypto.randomUUID() }),
    [store, scope, writable],
  );
  useLayoutEffect(() => {
    lifetime.active = writable;
    return () => {
      lifetime.active = false;
    };
  }, [writable, lifetime]);
  const capability = definition.photos;
  if (!store || !capability?.avatar) return null;
  const photos = snapshot.attachments.filter(
    (item) =>
      isDocumentPhoto(capability, item) &&
      snapshot.attachmentStatusBySlotId[item.slotId] !== "intent-mismatch",
  );
  const selected = findDocumentAvatar(capability, snapshot);
  const preview =
    selected && (findAvatarCrop(snapshot.attachments, selected) ?? selected);
  const apply = (choice: Parameters<typeof selectDocumentAvatar>[3]) =>
    selectDocumentAvatar(
      store,
      definition.kind,
      capability,
      choice,
      () => lifetime.active,
    );
  return (
    <DocumentAvatarControl
      key={`${lifetime.key}:${canEdit}`}
      avatarUrl={preview && imageUrlBySlotId[preview.slotId]}
      canEdit={canEdit}
      displayName={displayName}
      fallbackIcon={
        definition.kind === "contact" ? undefined : definition.createIcon
      }
      hasAvatar={!!selected}
      onApplyAvatar={apply}
      onRemoveAvatar={() => apply(null)}
      photos={photos}
      photoUrls={imageUrlBySlotId}
      selectedSlotId={selected?.slotId}
      onChoosePhoto={async (photo) => {
        if (findAvatarCrop(snapshot.attachments, photo)) {
          await apply({ slotId: photo.slotId });
          return null;
        }
        const key = snapshot.attachmentStorageKeyBySlotId[photo.slotId];
        const source = key && (await blobStore.openByteSource(key));
        if (!source)
          throw new Error("The photo is unavailable on this device.");
        if (
          isAutomaticBlobPreviewAllowed(photo) &&
          isAutomaticBlobPreviewAllowed(source)
        ) {
          await apply({ slotId: photo.slotId });
          return null;
        }
        // A user-selected full-size image is read explicitly for cropping.
        const bytes = await source.read(0, source.byteLength);
        return {
          photo,
          blob: new Blob([bytes], { type: photo.mimeType ?? "" }),
        };
      }}
    />
  );
}
