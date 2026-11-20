import { useContext } from "react";
import { useTearleadsRuntime } from "../../providers/sdk/TearleadsProvider";
import {
  DocumentContext,
  useDocument,
} from "../../stores/documents/DocumentsProvider";
import { DocumentAttachmentSlots } from "../shared/DocumentAttachmentSlots";
import { DocumentAvatar } from "../shared/DocumentAvatar";
import {
  photoCollectionSlot,
  removeDocumentPhoto,
} from "../shared/documentPhotos";
import { useAttachmentImageUrls } from "../shared/useAttachmentImageUrls";
import { useDocumentAttachmentSelection } from "../shared/useDocumentAttachmentSelection";
import {
  CONTACT_PHOTOS,
  contactDocumentProjectorDefinition,
} from "./contactDocumentDefinition";

const slots = [photoCollectionSlot(CONTACT_PHOTOS.slotId)];

export function useContactPhotos({
  displayName,
  isEditing,
}: {
  displayName: string;
  isEditing: boolean;
}) {
  const store = useContext(DocumentContext);
  const document = useDocument();
  const { infra } = useTearleadsRuntime();
  const imageUrlBySlotId = useAttachmentImageUrls(
    document.attachments,
    document.attachmentStorageKeyBySlotId,
    infra.blobStore,
  );
  const onSelectedAttachment = useDocumentAttachmentSelection({
    errorMessage: "Failed to attach contact photo",
    slots,
    replaceAttachment: document.replaceAttachment,
  });
  return {
    avatar: (
      <DocumentAvatar
        definition={contactDocumentProjectorDefinition}
        blobStore={infra.blobStore}
        isEditing={isEditing}
        displayName={displayName}
        imageUrlBySlotId={imageUrlBySlotId}
      />
    ),
    gallery: (
      <DocumentAttachmentSlots
        {...document}
        slots={slots}
        imageUrlBySlotId={imageUrlBySlotId}
        canAttach={
          document.ready && isEditing && document.canWrite && document.canAttach
        }
        onSelectedAttachment={onSelectedAttachment}
        onClearAttachment={(slotId) => {
          if (store) removeDocumentPhoto(store, CONTACT_PHOTOS, slotId);
        }}
      />
    ),
  };
}
