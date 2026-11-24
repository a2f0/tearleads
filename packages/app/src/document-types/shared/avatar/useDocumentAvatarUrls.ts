import type { DocumentStore } from "@tearleads/client-sdk";
import { useEffect, useState } from "react";
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
  useEffect(() => {
    if (!source || documents.length === 0) {
      setEntries(NO_AVATAR_ENTRIES);
      return;
    }

    // Only this run's listing may publish; a document the source already
    // opened keeps its entry from the first read, so its avatar never drops
    // while others open.
    let current = true;
    const followed = new Map<
      string,
      { store: DocumentStore; unsubscribe: () => void }
    >();
    const read = () => {
      if (!current) {
        return;
      }
      const next = documents.flatMap((document) => {
        const store = followed.get(document.localId)?.store;
        return store ? [readAvatarEntry(document, store)] : [];
      });
      setEntries((previous) =>
        sameAvatarEntries(previous, next) ? previous : next,
      );
    };
    const open = (document: AvatarDocument) => {
      void source.openDocument(document).then((store) => {
        if (current && store) {
          follow(document, store);
          read();
        }
      });
    };
    // A relink freezes the followed view; reopening follows the new owner.
    const follow = (document: AvatarDocument, store: DocumentStore) => {
      followed.get(document.localId)?.unsubscribe();
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().relinkedElsewhere) {
          open(document);
        }
        read();
      });
      followed.set(document.localId, { store, unsubscribe });
    };
    for (const document of documents) {
      const store = source.openedDocument(document.localId);
      if (store) {
        follow(document, store);
      } else {
        open(document);
      }
    }
    read();
    return () => {
      current = false;
      for (const { unsubscribe } of followed.values()) {
        unsubscribe();
      }
    };
  }, [documents, source]);

  return useAvatarUrls(entries, source?.blobStore ?? null);
}
