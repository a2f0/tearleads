import type { DocumentSummary } from "../../data/documentSummary";
import type { ContainerNode } from "../../stores/container-contents";
import { isSystemContainerNode } from "../../stores/container-contents";

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
  ) => boolean;
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
): (
  containerId: string,
  documents: ReadonlyArray<DocumentSummary>,
  force: boolean,
) => void {
  const pulledSystemDocumentVersions = new Set<string>();

  return (containerId, documents, force) => {
    const systemContainer = isSystemContainerNode(
      host.getContainer(containerId) ?? { systemSlot: null },
    );

    for (const document of documents) {
      if (!document.documentId) {
        continue;
      }

      if (systemContainer) {
        const versionKey = `${containerId}:${document.documentId}:${document.updatedAt}`;
        if (!pulledSystemDocumentVersions.has(versionKey)) {
          host.pullDocumentContent({
            containerId,
            documentId: document.documentId,
            localId: document.id,
          });
          pulledSystemDocumentVersions.add(versionKey);
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
