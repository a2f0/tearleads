import type { BlobStore, DocumentAttachment } from "@tearleads/client-sdk";
import { type RefObject, useEffect, useRef, useState } from "react";
import { isAutomaticBlobPreviewAllowed } from "./documentAttachmentUtils";

type AttachmentStorageKeyBySlotId = Readonly<Record<string, string>>;
type AttachmentImageUrlBySlotId = Readonly<Record<string, string>>;
type AttachmentObjectUrlEntry = {
  storageKey: string;
  url: string;
};

function revokeAttachmentObjectUrls(
  objectUrls: ReadonlyMap<string, AttachmentObjectUrlEntry>,
) {
  for (const entry of objectUrls.values()) {
    URL.revokeObjectURL(entry.url);
  }
}

async function buildAttachmentImageState(
  attachments: ReadonlyArray<DocumentAttachment>,
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId,
  blobStore: BlobStore,
  currentObjectUrls: ReadonlyMap<string, AttachmentObjectUrlEntry>,
): Promise<{
  createdObjectUrls: string[];
  nextImageUrlBySlotId: Record<string, string>;
  nextObjectUrls: Map<string, AttachmentObjectUrlEntry>;
}> {
  const nextObjectUrls = new Map<string, AttachmentObjectUrlEntry>();
  const nextImageUrlBySlotId: Record<string, string> = {};
  const createdObjectUrls: string[] = [];

  for (const attachment of attachments) {
    const storageKey = attachmentStorageKeyBySlotId[attachment.slotId];
    if (!storageKey) {
      continue;
    }

    const existingEntry = currentObjectUrls.get(attachment.slotId);
    if (existingEntry && existingEntry.storageKey === storageKey) {
      nextObjectUrls.set(attachment.slotId, existingEntry);
      nextImageUrlBySlotId[attachment.slotId] = existingEntry.url;
      continue;
    }

    const blobBytes = await blobStore.readBytes(storageKey);
    if (!blobBytes) {
      continue;
    }

    const url = URL.createObjectURL(
      new Blob([blobBytes], {
        type: attachment.mimeType ?? "application/octet-stream",
      }),
    );
    createdObjectUrls.push(url);
    nextObjectUrls.set(attachment.slotId, { storageKey, url });
    nextImageUrlBySlotId[attachment.slotId] = url;
  }

  return {
    createdObjectUrls,
    nextImageUrlBySlotId,
    nextObjectUrls,
  };
}

function applyAttachmentImageState(
  currentObjectUrls: ReadonlyMap<string, AttachmentObjectUrlEntry>,
  nextObjectUrls: ReadonlyMap<string, AttachmentObjectUrlEntry>,
  setImageUrlBySlotId: (value: AttachmentImageUrlBySlotId) => void,
  nextImageUrlBySlotId: AttachmentImageUrlBySlotId,
  objectUrlsRef: RefObject<Map<string, AttachmentObjectUrlEntry>>,
) {
  for (const [slotId, entry] of currentObjectUrls.entries()) {
    const nextEntry = nextObjectUrls.get(slotId);
    if (!nextEntry || nextEntry.url !== entry.url) {
      URL.revokeObjectURL(entry.url);
    }
  }

  objectUrlsRef.current = new Map(nextObjectUrls);
  setImageUrlBySlotId(nextImageUrlBySlotId);
}

export function useAttachmentImageUrls(
  attachments: ReadonlyArray<DocumentAttachment>,
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId,
  blobStore: BlobStore,
): AttachmentImageUrlBySlotId {
  const [imageUrlBySlotId, setImageUrlBySlotId] =
    useState<AttachmentImageUrlBySlotId>({});
  const objectUrlsRef = useRef<Map<string, AttachmentObjectUrlEntry>>(
    new Map(),
  );

  useEffect(() => {
    return () => {
      revokeAttachmentObjectUrls(objectUrlsRef.current);
      objectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadImages() {
      const imageAttachments = attachments.filter(
        (attachment) =>
          attachment.mimeType?.startsWith("image/") &&
          isAutomaticBlobPreviewAllowed(attachment) &&
          attachmentStorageKeyBySlotId[attachment.slotId],
      );

      if (imageAttachments.length === 0) {
        revokeAttachmentObjectUrls(objectUrlsRef.current);
        objectUrlsRef.current.clear();
        setImageUrlBySlotId({});
        return;
      }

      const currentObjectUrls = objectUrlsRef.current;
      const { createdObjectUrls, nextImageUrlBySlotId, nextObjectUrls } =
        await buildAttachmentImageState(
          imageAttachments,
          attachmentStorageKeyBySlotId,
          blobStore,
          currentObjectUrls,
        );

      if (cancelled) {
        for (const url of createdObjectUrls) {
          URL.revokeObjectURL(url);
        }
        return;
      }

      applyAttachmentImageState(
        currentObjectUrls,
        nextObjectUrls,
        setImageUrlBySlotId,
        nextImageUrlBySlotId,
        objectUrlsRef,
      );
    }

    void loadImages();

    return () => {
      cancelled = true;
    };
  }, [attachments, attachmentStorageKeyBySlotId, blobStore]);

  return imageUrlBySlotId;
}
