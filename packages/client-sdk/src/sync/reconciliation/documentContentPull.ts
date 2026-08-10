import type { ContainerNode } from "../../stores/container-contents";
import { isSystemContainerNode } from "../../stores/container-contents";
import type { ReconciliationHost } from "./serviceTypes";

interface ReconciledDocumentContentPullHost {
  readonly getContainer: (containerId: string) => ContainerNode | null;
  readonly pullDocumentContent: (input: {
    readonly containerId: string;
    readonly documentId: string;
    readonly localId: string;
  }) => void;
  readonly requestRegisteredDocumentRemoteSync: (
    localId: string,
    documentId: string,
  ) => void;
}

/**
 * Routes reconciled summaries into the appropriate content-sync policy.
 *
 * System-container contents cannot rely on a mini-app opening them on this
 * device, especially during identity recovery. Pull each remote version once.
 * Ordinary documents stay lazy unless an explicit refresh asks an already-open
 * store to revalidate.
 */
export function createReconciledDocumentContentPuller(
  host: ReconciledDocumentContentPullHost,
): ReconciliationHost["requestDocumentContentPull"] {
  // Retain only the last observed version for each system-container document.
  // Keeping the version in the key would grow this cache for every historical
  // updatedAt value over the reconciler's lifetime.
  const pulledSystemDocumentVersions = new Map<string, string>();

  return (containerId, documents, force) => {
    const systemContainer = isSystemContainerNode(
      host.getContainer(containerId) ?? { systemSlot: null },
    );

    for (const document of documents) {
      if (!document.documentId) {
        continue;
      }

      if (systemContainer) {
        // Container scope is significant: the same document can be linked into
        // multiple system containers whose keys establish different decryption
        // contexts for the transient store.
        const documentKey = `${containerId}:${document.documentId}`;
        if (
          pulledSystemDocumentVersions.get(documentKey) !== document.updatedAt
        ) {
          host.pullDocumentContent({
            containerId,
            documentId: document.documentId,
            localId: document.id,
          });
          pulledSystemDocumentVersions.set(documentKey, document.updatedAt);
        } else if (force) {
          // The first eager pull registers a document store before scheduling
          // its async sync. If that sync failed, a later explicit Refresh must
          // be able to retry the same server version without defeating normal
          // background dedupe.
          host.requestRegisteredDocumentRemoteSync(
            document.id,
            document.documentId,
          );
        }
        continue;
      }

      if (force) {
        host.requestRegisteredDocumentRemoteSync(
          document.id,
          document.documentId,
        );
      }
    }
  };
}
