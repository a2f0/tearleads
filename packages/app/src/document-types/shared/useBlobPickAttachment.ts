import type { BlobInfo, BlobStore } from "@tearleads/client-sdk";
import { useCallback, useEffect, useState } from "react";
import type { DocumentAttachmentBlobPickerConfig } from "./DocumentAttachmentSlots";
import { useDocumentBlobPick } from "./DocumentBlobPickContext";
import type { DocumentAttachmentSlot } from "./documentAttachmentUtils";
import { useDocumentBlobAttachmentSelection } from "./useDocumentAttachmentSelection";

// Bridges a structured document's attachment slots to the host's blob picker
// (the Explorer's blob-browser panel): "Choose Blob" routes to it for the slot,
// and the blob it returns is applied to the slot here. Returns `undefined` for
// the blobPicker config — so the "Choose Blob" button is simply hidden — when no
// pick provider is mounted (e.g. a document rendered standalone) or when the
// identity-local projection holds no blobs to pick (the picker would open empty).
export function useBlobPickAttachment(params: {
  blobStore: BlobStore;
  containerId: string | null;
  errorMessage: string;
  localId: string;
  replaceAttachment: Parameters<
    typeof useDocumentBlobAttachmentSelection
  >[0]["replaceAttachment"];
  slotIds: ReadonlyArray<string>;
}): DocumentAttachmentBlobPickerConfig | undefined {
  const {
    blobStore,
    containerId,
    errorMessage,
    localId,
    replaceAttachment,
    slotIds,
  } = params;
  const blobPick = useDocumentBlobPick();
  const handleSelectedBlobAttachment = useDocumentBlobAttachmentSelection({
    blobStore,
    errorMessage,
    replaceAttachment,
  });

  const consumeBlobPick = blobPick?.consumeBlobPick;
  const requestBlobPick = blobPick?.requestBlobPick;
  const loadPickableBlobCount = blobPick?.loadPickableBlobCount;

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

  // Hide "Choose Blob" until we confirm the identity-local projection has at
  // least one blob to pick, so it never routes to an empty global picker. Start
  // hidden and reveal once a positive count resolves. Re-check when the target
  // document's container changes because it is part of the pick return route.
  const [hasPickableBlobs, setHasPickableBlobs] = useState(false);
  useEffect(() => {
    if (!loadPickableBlobCount || containerId === null) {
      setHasPickableBlobs(false);
      return;
    }

    let active = true;
    void loadPickableBlobCount()
      .then((count) => {
        if (active) {
          setHasPickableBlobs(count > 0);
        }
      })
      .catch(() => {
        if (active) {
          setHasPickableBlobs(false);
        }
      });

    return () => {
      active = false;
    };
  }, [loadPickableBlobCount, containerId]);

  const onRequestBlobPick = useCallback(
    (slot: DocumentAttachmentSlot) => {
      if (!requestBlobPick || containerId === null) {
        return;
      }
      requestBlobPick({ containerId, localId, slot });
    },
    [containerId, localId, requestBlobPick],
  );

  if (!blobPick || containerId === null || !hasPickableBlobs) {
    return undefined;
  }

  return { onRequestBlobPick };
}
