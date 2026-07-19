import type { BlobStore } from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";
import { isAutomaticBlobPreviewAllowed } from "../shared/documentAttachmentUtils";
import type { ContactAvatarRef } from "./contactAvatarSlot";

interface ContactAvatarEntryLike {
  avatar?: ContactAvatarRef | undefined;
  id: string;
}

export type AvatarUrlByContactId = Readonly<Record<string, string>>;

interface AvatarObjectUrlEntry {
  storageKey: string;
  url: string;
}

interface AvatarUrlState {
  createdObjectUrls: string[];
  nextObjectUrls: Map<string, AvatarObjectUrlEntry>;
  nextUrlByContactId: Record<string, string>;
}

function getLoadableAvatar(
  entry: ContactAvatarEntryLike,
): (ContactAvatarRef & { storageKey: string }) | null {
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
  avatar: ContactAvatarRef & { storageKey: string },
  blobStore: BlobStore,
): Promise<string | null> {
  const blobBytes = await blobStore.readBytes(avatar.storageKey);
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
  entries: ReadonlyArray<ContactAvatarEntryLike>,
  blobStore: BlobStore,
  currentObjectUrls: ReadonlyMap<string, AvatarObjectUrlEntry>,
): Promise<AvatarUrlState> {
  const state: AvatarUrlState = {
    createdObjectUrls: [],
    nextObjectUrls: new Map(),
    nextUrlByContactId: {},
  };

  for (const entry of entries) {
    const avatar = getLoadableAvatar(entry);
    if (!avatar) {
      continue;
    }

    const existingEntry = currentObjectUrls.get(entry.id);
    if (existingEntry && existingEntry.storageKey === avatar.storageKey) {
      state.nextObjectUrls.set(entry.id, existingEntry);
      state.nextUrlByContactId[entry.id] = existingEntry.url;
      continue;
    }

    const url = await loadAvatarObjectUrl(avatar, blobStore);
    if (!url) {
      continue;
    }
    state.createdObjectUrls.push(url);
    state.nextObjectUrls.set(entry.id, { storageKey: avatar.storageKey, url });
    state.nextUrlByContactId[entry.id] = url;
  }

  return state;
}

function revokeReplacedAvatarUrls(
  currentObjectUrls: ReadonlyMap<string, AvatarObjectUrlEntry>,
  nextObjectUrls: ReadonlyMap<string, AvatarObjectUrlEntry>,
) {
  for (const [contactId, entry] of currentObjectUrls.entries()) {
    const nextEntry = nextObjectUrls.get(contactId);
    if (!nextEntry || nextEntry.url !== entry.url) {
      URL.revokeObjectURL(entry.url);
    }
  }
}

// Map each contact's avatar blob to an object URL, reusing URLs while the
// storage key is unchanged and revoking them when the avatar changes, the
// contact disappears, or the consumer unmounts.
export function useContactAvatarUrls(
  entries: ReadonlyArray<ContactAvatarEntryLike>,
  blobStore: BlobStore,
): AvatarUrlByContactId {
  const [urlByContactId, setUrlByContactId] = useState<AvatarUrlByContactId>(
    {},
  );
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
      const { createdObjectUrls, nextObjectUrls, nextUrlByContactId } =
        await buildAvatarUrlState(entries, blobStore, currentObjectUrls);

      if (cancelled) {
        for (const url of createdObjectUrls) {
          URL.revokeObjectURL(url);
        }
        return;
      }

      revokeReplacedAvatarUrls(currentObjectUrls, nextObjectUrls);
      objectUrlsRef.current = nextObjectUrls;
      setUrlByContactId(nextUrlByContactId);
    }

    void loadAvatars();

    return () => {
      cancelled = true;
    };
  }, [blobStore, entries]);

  return urlByContactId;
}
