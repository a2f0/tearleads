import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { useCallback, useEffect } from "react";
import type { DocumentAttachmentBlobPickerConfig } from "./DocumentAttachmentSlots";
import { useDocumentBlobPick } from "./DocumentBlobPickContext";
import type { DocumentAttachmentSlot } from "./documentAttachmentUtils";
import { useDocumentBlobAttachmentSelection } from "./useDocumentAttachmentSelection";

// Bridges a structured document's attachment slots to the host's blob picker
// (the Explorer's blob-browser panel): "Choose Blob" routes to it for the slot,
// and the blob it returns is applied to the slot here. Returns `undefined` for
// the blobPicker config when no pick provider is mounted (e.g. a document
// rendered standalone), so the "Choose Blob" button is simply hidden.
export function useBlobPickAttachment(params: {
  blobStore: BlobStore;
  containerId: string | null;
  errorMessage: string;
  localId: string;
  setAttachment: Parameters<
    typeof useDocumentBlobAttachmentSelection
  >[0]["setAttachment"];
  slotIds: ReadonlyArray<string>;
}): DocumentAttachmentBlobPickerConfig | undefined {
  const {
    blobStore,
    containerId,
    errorMessage,
    localId,
    setAttachment,
    slotIds,
  } = params;
  const blobPick = useDocumentBlobPick();
  const handleSelectedBlobAttachment = useDocumentBlobAttachmentSelection({
    blobStore,
    errorMessage,
    setAttachment,
  });

  const consumeBlobPick = blobPick?.consumeBlobPick;
  const requestBlobPick = blobPick?.requestBlobPick;

  // Apply any blob the picker routed back for one of this document's slots.
  // Returning from the picker re-mounts the document (the document-selection
  // route swaps it back in), so this effectively runs on remount; the deps keep
  // it from re-running every render while still re-checking if they change.
  useEffect(() => {
    if (!consumeBlobPick) {
      return;
    }

    let picked: { slotId: string; blob: BlobInfo } | null = null;
    for (const slotId of slotIds) {
      const blob = consumeBlobPick(localId, slotId);
      if (blob) {
        picked = { blob, slotId };
        break;
      }
    }

    if (picked) {
      void handleSelectedBlobAttachment(picked.slotId, picked.blob);
    }
  }, [consumeBlobPick, handleSelectedBlobAttachment, localId, slotIds]);

  const onRequestBlobPick = useCallback(
    (slot: DocumentAttachmentSlot) => {
      if (!requestBlobPick || containerId === null) {
        return;
      }
      requestBlobPick({ containerId, localId, slot });
    },
    [containerId, localId, requestBlobPick],
  );

  if (!blobPick || containerId === null) {
    return undefined;
  }

  return { onRequestBlobPick };
}
