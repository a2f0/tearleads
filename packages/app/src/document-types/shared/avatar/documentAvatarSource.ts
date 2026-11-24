import type {
  BlobStore,
  ContainerDocumentQueries,
  DocumentStore,
  Documents,
  StoredDocumentKind,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import type { DocumentPhotoCapability } from "../documentPhotos";

/** A listed document whose kind keeps a photo gallery, so it may have an avatar. */
export interface AvatarDocument {
  readonly documentKind: StoredDocumentKind;
  readonly localId: string;
  readonly photos: DocumentPhotoCapability;
}

/** Where listed documents' avatars come from: their stores, then their blobs. */
export interface DocumentAvatarSource {
  readonly blobStore: BlobStore;
  /**
   * The document's store, opened once per source and reused after that.
   * Null when there is no local copy to read the avatar from.
   */
  readonly openDocument: (
    document: AvatarDocument,
  ) => Promise<DocumentStore | null>;
  /** The store this source already opened for a document, without opening one. */
  readonly openedDocument: (localId: string) => DocumentStore | null;
}

interface DocumentAvatarSourceInput {
  readonly blobStore: BlobStore;
  readonly dbStatus: string;
  readonly documentQueries: Pick<
    ContainerDocumentQueries,
    "loadDocumentSummary"
  >;
  readonly documents: Pick<Documents, "open">;
}

/** One listed document's store, while it opens and once it is open. */
type OpenedAvatarStore =
  | { readonly status: "opening"; readonly open: Promise<DocumentStore | null> }
  | { readonly status: "open"; readonly store: DocumentStore };

function isRelinkedElsewhere(store: DocumentStore): boolean {
  return store.getSnapshot().relinkedElsewhere === true;
}

/**
 * Opens listed documents to read their avatars, and never creates one:
 * - Only a document with a local copy opens, and it opens with
 *   `createIfMissing: false`, so a row deleted after the read stays deleted.
 * - It opens in its own container, never the listing's, so an editor of a
 *   linked document keeps its container scope.
 * - It opens on demand, so opening starts no remote sync; a later view that
 *   opens it normally still runs the startup probe.
 * Each is a full store, loaded as any view loads one, and the SDK keeps it for
 * the session. The source keeps the stores it loaded too, so a list that
 * remounts or scrolls back reads them without reopening: a reopen replaces the
 * store's runtime and can arm a reconnect probe. A store a relink displaced is
 * dropped, and the next open follows the record that now owns the document.
 */
export function createDocumentAvatarSource(
  input: DocumentAvatarSourceInput,
): DocumentAvatarSource {
  const { blobStore, dbStatus, documentQueries, documents } = input;
  const stores = new Map<string, OpenedAvatarStore>();

  const openedDocument = (localId: string): DocumentStore | null => {
    const entry = stores.get(localId);
    if (entry?.status !== "open") {
      return null;
    }
    if (isRelinkedElsewhere(entry.store)) {
      stores.delete(localId);
      return null;
    }
    return entry.store;
  };

  const openLocalCopy = async (
    document: AvatarDocument,
  ): Promise<DocumentStore | null> => {
    if (dbStatus !== "ready") {
      return null;
    }

    const summary = await documentQueries.loadDocumentSummary(
      document.localId,
      { requireHydrated: true },
    );
    if (!summary?.containerId) {
      return null;
    }

    const store = documents.open(
      {
        containerId: summary.containerId,
        documentId: summary.documentId,
        localId: summary.id,
      },
      { createIfMissing: false, remoteSyncMode: "on-demand" },
    );
    // A displaced view never shows again, and a record deleted while it
    // opened leaves a store that never loads. Neither is kept: the next
    // listing opens the owner, or tries the document again.
    if (isRelinkedElsewhere(store) || !(await store.ensureInitialized())) {
      return null;
    }
    return store;
  };

  return {
    blobStore,
    openDocument: (document) => {
      const store = openedDocument(document.localId);
      if (store) {
        return Promise.resolve(store);
      }
      const entry = stores.get(document.localId);
      if (entry?.status === "opening") {
        return entry.open;
      }

      // A document with no local copy yet, or whose open failed, is not
      // remembered, so a later listing tries it again.
      const open = openLocalCopy(document)
        .catch(() => null)
        .then((next) => {
          if (next) {
            stores.set(document.localId, { status: "open", store: next });
          } else {
            stores.delete(document.localId);
          }
          return next;
        });
      stores.set(document.localId, { open, status: "opening" });
      return open;
    },
    openedDocument,
  };
}

/**
 * The avatar source for the current database. A new database or domain
 * brings new document queries, and so a new source that reopens every listed
 * document in its scope.
 */
export function useDocumentAvatarSource(
  runtime: {
    readonly infra: {
      readonly blobStore: BlobStore;
      readonly dbStatus: string;
    };
  },
  documentQueries: DocumentAvatarSourceInput["documentQueries"],
): DocumentAvatarSource {
  const { documents } = useTearleads();
  const { blobStore, dbStatus } = runtime.infra;
  return useMemo(
    () =>
      createDocumentAvatarSource({
        blobStore,
        dbStatus,
        documentQueries,
        documents,
      }),
    [blobStore, dbStatus, documentQueries, documents],
  );
}
