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
  /** Null when there is no local copy to read the avatar from. */
  readonly openDocument: (
    document: AvatarDocument,
  ) => Promise<DocumentStore | null>;
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

/**
 * Opens listed documents to read their avatars, and never creates one:
 * - Only a document with a local copy opens. A listed row can be stale, and
 *   opening a missing one would create it.
 * - It opens in its own container, never the listing's, so an editor of a
 *   linked document keeps its container scope.
 * - It opens on demand, so opening starts no remote sync; a later view that
 *   opens it normally still runs the startup probe.
 * Each is a full store, loaded as any view loads one (load-time maintenance
 * included), and the SDK keeps it for the session. Once open, it takes part in
 * domain-wide sync requests and reconnect probes like any open document.
 * Stores are shared per domain, so one another view already loaded is read
 * without loading it again.
 */
export function createDocumentAvatarSource(
  input: DocumentAvatarSourceInput,
): DocumentAvatarSource {
  const { blobStore, dbStatus, documentQueries, documents } = input;
  return {
    blobStore,
    openDocument: async (document) => {
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

      return documents.open(
        {
          containerId: summary.containerId,
          documentId: summary.documentId,
          localId: summary.id,
        },
        { remoteSyncMode: "on-demand" },
      );
    },
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
