import type { BlobStore, DocumentAttachment } from "@tearleads/client-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AttachmentPreview,
  type PreviewResult,
  transitionAttachmentPreview,
} from "./attachmentPreviewState";
import { isAutomaticBlobPreviewAllowed } from "./documentAttachmentUtils";
import {
  MAX_IMAGE_PREVIEW_READS,
  readImagePreviewBytes,
} from "./readImagePreviewBytes";

interface Request {
  blobStore: BlobStore;
  storageKey: string;
  mimeType: string;
}
interface Entry {
  lifetime: AbortController;
  request: Request;
  preview: AttachmentPreview;
}

function sameSource(entry: Entry | undefined, request: Request) {
  return (
    entry?.request.blobStore === request.blobStore &&
    entry.request.storageKey === request.storageKey &&
    entry.request.mimeType === request.mimeType
  );
}
function release(preview: AttachmentPreview) {
  if (preview.status === "ready") URL.revokeObjectURL(preview.url);
}

async function load(
  request: Request,
  current: () => boolean,
  deadline: AbortSignal,
  onCapacity: (status: "start" | "waiting-for-reader") => void,
): Promise<PreviewResult> {
  try {
    const bytes = await readImagePreviewBytes(
      request.blobStore,
      request.storageKey,
      deadline,
      onCapacity,
    );
    if (bytes && current())
      return {
        status: "ready",
        url: URL.createObjectURL(new Blob([bytes], { type: request.mimeType })),
      };
  } catch {
    // Other slots can still render when reading this file fails.
  }
  return { status: "unavailable" };
}

async function updatePreview(
  slot: string,
  entry: Entry,
  activeEntries: Map<string, Entry>,
  generation: () => number,
  publish: (entries: ReadonlyMap<string, Entry>) => void,
) {
  const current = () => !entry.lifetime.signal.aborted;
  if (!current()) return;
  const started = generation();
  const result = await load(
    entry.request,
    current,
    entry.lifetime.signal,
    (status) => {
      if (!current()) return;
      const currentEntry = activeEntries.get(slot);
      if (!currentEntry) return;
      activeEntries.set(slot, {
        ...currentEntry,
        preview: transitionAttachmentPreview(currentEntry.preview, { status }),
      });
      publish(new Map(activeEntries));
    },
  );
  if (!current()) {
    release(result);
    return;
  }
  const retry = result.status === "unavailable" && generation() !== started;
  if (retry) activeEntries.delete(slot); // Give waiting slots their turn before a retry.
  activeEntries.set(slot, {
    ...entry,
    preview: transitionAttachmentPreview(
      entry.preview,
      retry ? { status: "retry" } : result,
    ),
  });
  publish(new Map(activeEntries));
}

function discardStalePreviews(
  activeEntries: Map<string, Entry>,
  requests: ReadonlyMap<string, Request>,
  refreshCompleted: boolean,
) {
  let changed = false;
  for (const [slot, entry] of activeEntries) {
    const requested = requests.get(slot);
    const retry = refreshCompleted && entry.preview.status === "unavailable";
    if (requested && sameSource(entry, requested) && !retry) continue;
    entry.lifetime.abort();
    release(entry.preview);
    activeEntries.delete(slot);
    changed = true;
  }
  return changed;
}

// Only current slots occupy a worker. A superseded read may still be waiting
// for the filesystem, but cannot start another byte read or publish its URL.
function startQueuedPreviews(
  active: Map<string, Entry>,
  generation: () => number,
  publish: (entries: ReadonlyMap<string, Entry>) => void,
) {
  let available = MAX_IMAGE_PREVIEW_READS;
  for (const { preview } of active.values())
    if (preview.status === "loading" || preview.status === "waiting-for-reader")
      available--;
  for (const [slot, entry] of active) {
    if (available === 0) break;
    if (entry.preview.status !== "queued") continue;
    available--;
    const started = {
      ...entry,
      preview: transitionAttachmentPreview(entry.preview, { status: "start" }),
    };
    active.set(slot, started);
    void updatePreview(slot, started, active, generation, publish).then(() =>
      startQueuedPreviews(active, generation, publish),
    );
  }
}

export function useAttachmentImageUrls(
  attachments: ReadonlyArray<DocumentAttachment>,
  storageKeys: Readonly<Record<string, string>>,
  blobStore: BlobStore,
  syncing: boolean,
) {
  const requests = useMemo(() => {
    const result = new Map<string, Request>();
    for (const attachment of attachments) {
      const storageKey = storageKeys[attachment.slotId];
      if (
        storageKey &&
        attachment.mimeType?.startsWith("image/") &&
        isAutomaticBlobPreviewAllowed(attachment)
      ) {
        result.set(attachment.slotId, {
          storageKey,
          blobStore,
          mimeType: attachment.mimeType,
        });
      }
    }
    return result;
  }, [attachments, storageKeys, blobStore]);
  const active = useRef(new Map<string, Entry>());
  const wasSyncing = useRef(syncing);
  const refreshGeneration = useRef(0);
  const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(
    () => new Map(),
  );
  useEffect(() => {
    const entries = active.current;
    return () => {
      for (const entry of entries.values()) {
        entry.lifetime.abort();
        release(entry.preview);
      }
      entries.clear();
    };
  }, []);
  useEffect(() => {
    const activeEntries = active.current;
    const refreshCompleted = wasSyncing.current && !syncing;
    wasSyncing.current = syncing;
    if (refreshCompleted) refreshGeneration.current++;
    let changed = discardStalePreviews(
      activeEntries,
      requests,
      refreshCompleted,
    );
    for (const [slot, request] of requests) {
      if (activeEntries.has(slot)) continue;
      const entry: Entry = {
        request,
        lifetime: new AbortController(),
        preview: { status: "queued" },
      };
      activeEntries.set(slot, entry);
      changed = true;
    }
    startQueuedPreviews(
      activeEntries,
      () => refreshGeneration.current,
      setEntries,
    );
    if (changed) setEntries(new Map(activeEntries));
  }, [requests, syncing]);

  return useMemo(() => {
    const imageUrlBySlotId: Record<string, string> = Object.create(null);
    const loadingPreviewSlots = new Set<string>();
    for (const [slot, request] of requests) {
      const entry = entries.get(slot);
      const preview = sameSource(entry, request) ? entry?.preview : undefined;
      if (preview?.status === "ready") imageUrlBySlotId[slot] = preview.url;
      else if (preview?.status === "loading") loadingPreviewSlots.add(slot);
    }
    return { imageUrlBySlotId, loadingPreviewSlots };
  }, [entries, requests]);
}
