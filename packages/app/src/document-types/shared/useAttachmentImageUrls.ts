import type { BlobStore, DocumentAttachment } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTearleadsExternalValue } from "../../providers/sdk/useTearleadsSubscription";
import {
  getPreviewReadHealth,
  requestPreviewRead,
  subscribePreviewReadHealth,
} from "./attachmentPreviewReads";
import { isAutomaticBlobPreviewAllowed } from "./documentAttachmentUtils";

type AttachmentStorageKeyBySlotId = Readonly<Record<string, string>>;
type AttachmentImageUrlBySlotId = Readonly<Record<string, string>>;
interface PublishedPreview {
  readonly storageKey: string;
  readonly url: string;
}

function previewTargets(
  attachments: ReadonlyArray<DocumentAttachment>,
  storageKeyBySlotId: AttachmentStorageKeyBySlotId,
): Map<string, { mimeType: string; storageKey: string }> {
  const targets = new Map<string, { mimeType: string; storageKey: string }>();
  for (const attachment of attachments) {
    const storageKey = storageKeyBySlotId[attachment.slotId];
    if (
      storageKey &&
      attachment.mimeType?.startsWith("image/") &&
      isAutomaticBlobPreviewAllowed(attachment)
    )
      targets.set(attachment.slotId, {
        mimeType: attachment.mimeType,
        storageKey,
      });
  }
  return targets;
}

function urlsOf(
  published: ReadonlyMap<string, PublishedPreview>,
): AttachmentImageUrlBySlotId {
  return Object.fromEntries(
    Array.from(published, ([slotId, preview]) => [slotId, preview.url]),
  );
}

/** The preview pool's health for one blob store, as a React value. */
export function usePreviewReadHealth(
  blobStore: Pick<BlobStore, "openByteSource">,
) {
  const subscribe = useCallback(
    (listener: () => void) => subscribePreviewReadHealth(blobStore, listener),
    [blobStore],
  );
  const getSnapshot = useCallback(
    () => getPreviewReadHealth(blobStore),
    [blobStore],
  );
  return useTearleadsExternalValue(subscribe, getSnapshot);
}

/**
 * Object URLs for a document's image attachments. Each preview is published
 * as soon as its own read finishes, so one unresponsive file never holds back
 * its siblings. Reads go through the shared preview pool, which bounds native
 * filesystem calls; a result that arrives after the document closed or
 * changed its file is dropped, never published.
 */
export function useAttachmentImageUrls(
  attachments: ReadonlyArray<DocumentAttachment>,
  attachmentStorageKeyBySlotId: AttachmentStorageKeyBySlotId,
  blobStore: BlobStore,
): AttachmentImageUrlBySlotId {
  const [imageUrlBySlotId, setImageUrlBySlotId] =
    useState<AttachmentImageUrlBySlotId>({});
  const published = useRef(new Map<string, PublishedPreview>());
  const publishedStore = useRef(blobStore);
  // A retry re-requests every preview this document still lacks.
  const { retryGeneration } = usePreviewReadHealth(blobStore);

  useEffect(
    () => () => {
      for (const preview of published.current.values())
        URL.revokeObjectURL(preview.url);
      published.current.clear();
    },
    [],
  );

  useEffect(() => {
    void retryGeneration;
    const targets = previewTargets(attachments, attachmentStorageKeyBySlotId);
    const current = published.current;
    let changed = false;
    for (const [slotId, preview] of current) {
      if (
        publishedStore.current === blobStore &&
        targets.get(slotId)?.storageKey === preview.storageKey
      )
        continue;
      URL.revokeObjectURL(preview.url);
      current.delete(slotId);
      changed = true;
    }
    publishedStore.current = blobStore;
    if (changed) setImageUrlBySlotId(urlsOf(current));

    let disposed = false;
    const releases: Array<() => void> = [];
    for (const [slotId, target] of targets) {
      if (current.has(slotId)) continue;
      releases.push(
        requestPreviewRead(blobStore, target.storageKey, (result) => {
          if (disposed || result.status !== "read" || !result.bytes) return;
          const url = URL.createObjectURL(
            new Blob([result.bytes], { type: target.mimeType }),
          );
          current.set(slotId, { storageKey: target.storageKey, url });
          setImageUrlBySlotId(urlsOf(current));
        }),
      );
    }
    return () => {
      disposed = true;
      for (const release of releases) release();
    };
  }, [attachments, attachmentStorageKeyBySlotId, blobStore, retryGeneration]);

  return imageUrlBySlotId;
}
