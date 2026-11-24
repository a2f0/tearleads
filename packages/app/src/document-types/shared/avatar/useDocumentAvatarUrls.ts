import type {
  BlobStore,
  DocumentStore,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useEffect, useMemo, useState } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import type { DocumentPhotoCapability } from "../documentPhotos";
import {
  getDocumentAvatarRef,
  sameDocumentAvatarRef,
} from "./documentAvatarRef";
import {
  type AvatarEntry,
  type AvatarUrlById,
  useAvatarUrls,
} from "./useAvatarUrls";

/** A listed document whose kind keeps a photo gallery, so it may have an avatar. */
export interface AvatarDocument {
  readonly containerId: string;
  readonly documentId: string | null;
  readonly documentKind: StoredDocumentKind;
  readonly localId: string;
  readonly photos: DocumentPhotoCapability;
}

/** Where listed documents' avatars come from: their stores, then their blobs. */
export interface DocumentAvatarSource {
  readonly blobStore: BlobStore;
  /** Null while there is no open database to read the document from. */
  readonly openDocument: (document: AvatarDocument) => DocumentStore | null;
}

interface DocumentAvatarSourceRuntime {
  readonly infra: { readonly blobStore: BlobStore; readonly dbStatus: string };
}

/**
 * Opens listed documents for their avatars. A listing reads each document's
 * local copy and never starts a remote sync of its own; opening the document
 * itself still syncs it. Stores are shared per domain, so a document another
 * view already loaded is read without loading it again. A database or domain
 * switch lists new rows, which reopens them in the current scope.
 */
export function useDocumentAvatarSource(
  runtime: DocumentAvatarSourceRuntime,
): DocumentAvatarSource {
  const { documents } = useTearleads();
  const { blobStore, dbStatus } = runtime.infra;
  return useMemo(
    () => ({
      blobStore,
      openDocument: (document) =>
        dbStatus !== "ready"
          ? null
          : documents.open(
              {
                containerId: document.containerId,
                documentId: document.documentId,
                initialDocumentKind: document.documentKind,
                localId: document.localId,
              },
              { remoteSyncMode: "on-demand" },
            ),
    }),
    [blobStore, dbStatus, documents],
  );
}

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
        document.containerId === other.containerId &&
        document.documentId === other.documentId &&
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
 * document without one, or whose copy is not loaded yet, has no entry, so
 * its row shows the kind's fallback glyph.
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

    const opened = documents.flatMap((document) => {
      const store = source.openDocument(document);
      return store ? [{ document, store }] : [];
    });
    const read = () => {
      const next = opened.map(({ document, store }) =>
        readAvatarEntry(document, store),
      );
      setEntries((current) =>
        sameAvatarEntries(current, next) ? current : next,
      );
    };
    const unsubscribes = opened.map(({ store }) => store.subscribe(read));
    read();
    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [documents, source]);

  return useAvatarUrls(entries, source?.blobStore ?? null);
}
