import type { BlobStore } from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";
import {
  isAutomaticBlobPreviewAllowed,
  readAutomaticPreviewBlobBytes,
} from "../documentAttachmentUtils";
import type { DocumentAvatarRef } from "./documentAvatarRef";

/** One document, keyed by its local id, and the avatar it has chosen. */
export interface AvatarEntry {
  avatar?: DocumentAvatarRef | null | undefined;
  id: string;
}

export type AvatarUrlById = Readonly<Record<string, string>>;

interface AvatarObjectUrlEntry {
  storageKey: string;
  url: string;
}

interface AvatarUrlState {
  createdObjectUrls: string[];
  nextObjectUrls: Map<string, AvatarObjectUrlEntry>;
  nextUrlById: Record<string, string>;
}

function getLoadableAvatar(
  entry: AvatarEntry,
): (DocumentAvatarRef & { storageKey: string }) | null {
  const avatar = entry.avatar;
  if (
    !avatar?.storageKey ||
    avatar.mimeType?.startsWith("image/") !== true ||
    !isAutomaticBlobPreviewAllowed(avatar)
  ) {
    return null;
  }

  return { ...avatar, storageKey: avatar.storageKey };
}

function revokeAvatarObjectUrls(
  objectUrls: ReadonlyMap<string, AvatarObjectUrlEntry>,
) {
  for (const entry of objectUrls.values()) {
    URL.revokeObjectURL(entry.url);
  }
}

async function loadAvatarObjectUrl(
  avatar: DocumentAvatarRef & { storageKey: string },
  blobStore: BlobStore,
): Promise<string | null> {
  const blobBytes = await readAutomaticPreviewBlobBytes(
    blobStore,
    avatar.storageKey,
  );
  if (!blobBytes) {
    return null;
  }

  return URL.createObjectURL(
    new Blob([blobBytes], {
      type: avatar.mimeType ?? "application/octet-stream",
    }),
  );
}

async function buildAvatarUrlState(
  entries: ReadonlyArray<AvatarEntry>,
  blobStore: BlobStore | null,
  currentObjectUrls: ReadonlyMap<string, AvatarObjectUrlEntry>,
): Promise<AvatarUrlState> {
  const state: AvatarUrlState = {
    createdObjectUrls: [],
    nextObjectUrls: new Map(),
    nextUrlById: {},
  };
  // Without a blob store nothing loads, and any earlier URLs are revoked.
  if (!blobStore) {
    return state;
  }

  for (const entry of entries) {
    const avatar = getLoadableAvatar(entry);
    if (!avatar) {
      continue;
    }

    const existingEntry = currentObjectUrls.get(entry.id);
    if (existingEntry && existingEntry.storageKey === avatar.storageKey) {
      state.nextObjectUrls.set(entry.id, existingEntry);
      state.nextUrlById[entry.id] = existingEntry.url;
      continue;
    }

    const url = await loadAvatarObjectUrl(avatar, blobStore);
    if (!url) {
      continue;
    }
    state.createdObjectUrls.push(url);
    state.nextObjectUrls.set(entry.id, { storageKey: avatar.storageKey, url });
    state.nextUrlById[entry.id] = url;
  }

  return state;
}

function revokeReplacedAvatarUrls(
  currentObjectUrls: ReadonlyMap<string, AvatarObjectUrlEntry>,
  nextObjectUrls: ReadonlyMap<string, AvatarObjectUrlEntry>,
) {
  for (const [id, entry] of currentObjectUrls.entries()) {
    const nextEntry = nextObjectUrls.get(id);
    if (!nextEntry || nextEntry.url !== entry.url) {
      URL.revokeObjectURL(entry.url);
    }
  }
}

// Map each document's avatar blob to an object URL, reusing URLs while the
// storage key is unchanged and revoking them when the avatar changes, the
// document disappears, or the consumer unmounts.
export function useAvatarUrls(
  entries: ReadonlyArray<AvatarEntry>,
  blobStore: BlobStore | null,
): AvatarUrlById {
  const [urlById, setUrlById] = useState<AvatarUrlById>({});
  const objectUrlsRef = useRef(new Map<string, AvatarObjectUrlEntry>());

  useEffect(() => {
    return () => {
      revokeAvatarObjectUrls(objectUrlsRef.current);
      objectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAvatars() {
      const currentObjectUrls = objectUrlsRef.current;
      const { createdObjectUrls, nextObjectUrls, nextUrlById } =
        await buildAvatarUrlState(entries, blobStore, currentObjectUrls);

      if (cancelled) {
        for (const url of createdObjectUrls) {
          URL.revokeObjectURL(url);
        }
        return;
      }

      revokeReplacedAvatarUrls(currentObjectUrls, nextObjectUrls);
      objectUrlsRef.current = nextObjectUrls;
      setUrlById(nextUrlById);
    }

    void loadAvatars();

    return () => {
      cancelled = true;
    };
  }, [blobStore, entries]);

  return urlById;
}
