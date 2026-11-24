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

function sameAvatarDocuments(
  left: ReadonlyArray<AvatarDocument>,
  right: ReadonlyArray<AvatarDocument>,
): boolean {
  return (
    left.length === right.length &&
    left.every((document, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        document.localId === other.localId &&
        document.documentKind === other.documentKind &&
        document.photos === other.photos
      );
    })
  );
}

// A refreshed listing that names the same documents keeps their stores open
// instead of reopening every one.
function useStableAvatarDocuments(
  documents: ReadonlyArray<AvatarDocument>,
): ReadonlyArray<AvatarDocument> {
  const [stable, setStable] = useState(documents);
  if (stable !== documents && !sameAvatarDocuments(stable, documents)) {
    setStable(documents);
  }
  return stable;
}

/**
 * Object URLs for listed documents' chosen avatars, keyed by local id. A
 * document without one, or whose copy is not local or not loaded yet, has no
 * entry, so its row shows the kind's fallback glyph.
 */
export function useDocumentAvatarUrls(
  source: DocumentAvatarSource | null,
  listedDocuments: ReadonlyArray<AvatarDocument>,
): AvatarUrlById {
  const documents = useStableAvatarDocuments(listedDocuments);
  const [entries, setEntries] = useState(NO_AVATAR_ENTRIES);
  useEffect(() => {
    if (!source || documents.length === 0) {
      setEntries(NO_AVATAR_ENTRIES);
      return;
    }

    // Opens finish in any order; only this run's listing may publish, and
    // only once its stores are subscribed.
    let current = true;
    const storesByLocalId = new Map<string, DocumentStore>();
    const unsubscribes: Array<() => void> = [];
    const read = () => {
      if (!current) {
        return;
      }
      const next = documents.flatMap((document) => {
        const store = storesByLocalId.get(document.localId);
        return store ? [readAvatarEntry(document, store)] : [];
      });
      setEntries((previous) =>
        sameAvatarEntries(previous, next) ? previous : next,
      );
    };
    const opens = documents.map((document) =>
      source.openDocument(document).then((store) => {
        if (!current || !store) {
          return;
        }
        storesByLocalId.set(document.localId, store);
        unsubscribes.push(store.subscribe(read));
        read();
      }),
    );
    // A failed lookup leaves its row on the fallback glyph; once every open
    // settles, rows from an earlier listing that this one dropped clear too.
    void Promise.allSettled(opens).then(read);
    return () => {
      current = false;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [documents, source]);

  return useAvatarUrls(entries, source?.blobStore ?? null);
}
