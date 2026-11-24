import type { DocumentStore } from "@tearleads/client-sdk";
import { useEffect, useRef, useState } from "react";
import {
  getDocumentAvatarRef,
  sameDocumentAvatarRef,
} from "./documentAvatarRef";
import type {
  AvatarDocument,
  DocumentAvatarSource,
} from "./documentAvatarSource";
import {
  type AvatarEntry,
  type AvatarUrlById,
  useAvatarUrls,
} from "./useAvatarUrls";

const NO_AVATAR_ENTRIES: ReadonlyArray<AvatarEntry> = [];

/**
 * The stores one source has opened, kept while the listing scrolls or
 * changes. The SDK never releases a document store, so keeping the reference
 * costs nothing, and a document listed again is read at once, not reopened.
 */
interface OpenedAvatarStores {
  readonly opened: Map<string, DocumentStore>;
  readonly opening: Map<string, Promise<DocumentStore | null>>;
  readonly source: DocumentAvatarSource;
}

function openAvatarStore(
  stores: OpenedAvatarStores,
  document: AvatarDocument,
): Promise<DocumentStore | null> {
  const pending = stores.opening.get(document.localId);
  if (pending) {
    return pending;
  }

  // A document with no local copy yet is not remembered, so a later listing
  // tries it again.
  const opening = stores.source
    .openDocument(document)
    .then(
      (store) => {
        if (store) {
          stores.opened.set(document.localId, store);
        }
        return store;
      },
      () => null,
    )
    .finally(() => stores.opening.delete(document.localId));
  stores.opening.set(document.localId, opening);
  return opening;
}

function readAvatarEntry(
  document: AvatarDocument,
  store: DocumentStore,
): AvatarEntry {
  const snapshot = store.getSnapshot();
  return {
    avatar:
      snapshot.ready && snapshot.documentKind === document.documentKind
        ? getDocumentAvatarRef(document.photos, snapshot)
        : null,
    id: document.localId,
  };
}

function sameAvatarEntries(
  left: ReadonlyArray<AvatarEntry>,
  right: ReadonlyArray<AvatarEntry>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.id === right[index]?.id &&
        sameDocumentAvatarRef(entry.avatar, right[index]?.avatar),
    )
  );
}

/**
 * Object URLs for listed documents' chosen avatars, keyed by local id. A
 * document without one, or whose copy is not local or not loaded yet, has no
 * entry, so its row shows the kind's fallback glyph. Pass a memoized listing:
 * each new one resubscribes the listed stores.
 */
export function useDocumentAvatarUrls(
  source: DocumentAvatarSource | null,
  documents: ReadonlyArray<AvatarDocument>,
): AvatarUrlById {
  const [entries, setEntries] = useState(NO_AVATAR_ENTRIES);
  const storesRef = useRef<OpenedAvatarStores | null>(null);
  useEffect(() => {
    if (!source || documents.length === 0) {
      setEntries(NO_AVATAR_ENTRIES);
      return;
    }

    if (storesRef.current?.source !== source) {
      storesRef.current = { opened: new Map(), opening: new Map(), source };
    }
    const stores = storesRef.current;
    // Only this run's listing may publish; a document still listed keeps its
    // entry from the first read, so its avatar never drops while others open.
    let current = true;
    const unsubscribes = new Map<string, () => void>();
    const read = () => {
      if (!current) {
        return;
      }
      const next = documents.flatMap((document) => {
        const store = stores.opened.get(document.localId);
        return store ? [readAvatarEntry(document, store)] : [];
      });
      setEntries((previous) =>
        sameAvatarEntries(previous, next) ? previous : next,
      );
    };
    const follow = (localId: string) => {
      const store = stores.opened.get(localId);
      if (store && !unsubscribes.has(localId)) {
        unsubscribes.set(localId, store.subscribe(read));
      }
    };
    for (const document of documents) {
      if (stores.opened.has(document.localId)) {
        follow(document.localId);
        continue;
      }
      void openAvatarStore(stores, document).then((store) => {
        if (current && store) {
          follow(document.localId);
          read();
        }
      });
    }
    read();
    return () => {
      current = false;
      for (const unsubscribe of unsubscribes.values()) {
        unsubscribe();
      }
    };
  }, [documents, source]);

  return useAvatarUrls(entries, source?.blobStore ?? null);
}
