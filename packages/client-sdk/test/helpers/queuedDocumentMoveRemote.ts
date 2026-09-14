import type { DocumentLinkSetMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerWriterProjectionResponse,
  DocumentLinkSetMutationResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { createLinkSetResponseFromRequest } from "./documentFixtures";

/**
 * The mock server's view of one document across a queued move: the writer
 * projection the client fetches, and the accepted link/unlink submissions
 * that advance it. The new link set is exactly the request's content-key
 * target set, so any container in `containerProjections` can be linked.
 */
export interface QueuedDocumentMoveRemote {
  writerProjection: DocumentWriterProjectionResponse;
  submitLink(
    documentId: string,
    request: DocumentLinkSetMutationRequest,
  ): Promise<DocumentLinkSetMutationResponse>;
  submitUnlink(
    documentId: string,
    request: DocumentLinkSetMutationRequest,
  ): Promise<DocumentLinkSetMutationResponse | null>;
}

export function createQueuedDocumentMoveRemote(input: {
  containerProjections: readonly ContainerWriterProjectionResponse[];
  remoteRequests: string[];
  submittedOperations: string[];
  unlinkAvailable: boolean;
  writerProjection: DocumentWriterProjectionResponse;
}): QueuedDocumentMoveRemote {
  const projectionById = new Map(
    input.containerProjections.map((projection) => [
      projection.containerId,
      projection,
    ]),
  );
  const linkedProjections = (request: DocumentLinkSetMutationRequest) =>
    Array.from(
      new Set(
        request.contentKeyBundle.targets.map((target) => target.containerId),
      ),
    )
      .sort()
      .map((containerId) => {
        const projection = projectionById.get(containerId);
        if (!projection) {
          throw new Error(`No fixture projection for container ${containerId}`);
        }
        return projection;
      });

  const remote: QueuedDocumentMoveRemote = {
    writerProjection: input.writerProjection,
    async submitLink(documentId, request) {
      input.submittedOperations.push("link");
      input.remoteRequests.push("link");
      const response = await createLinkSetResponseFromRequest(
        documentId,
        request,
      );
      const previous = remote.writerProjection;
      const authorizingContainerPaths = linkedProjections(request);
      const added = authorizingContainerPaths.filter(
        (projection) =>
          !previous.authorizingContainerPaths.some(
            (existing) => existing.containerId === projection.containerId,
          ),
      );
      remote.writerProjection = {
        authorizingContainerPaths,
        contentKeyBundle: response.contentKeyBundle,
        documentContainerManifestHistory: [
          ...previous.documentContainerManifestHistory,
          ...added.flatMap((projection) => [
            ...projection.path,
            ...projection.containerKeks.flatMap(
              (kek) => kek.containerManifestHistory,
            ),
          ]),
        ],
        documentId: response.id,
        documentKekTargets: response.documentKekTargets,
        documentManifest: response.accessManifest,
        documentManifestContainerPaths: [
          ...previous.documentManifestContainerPaths,
          ...added.map((projection) => [...projection.path]),
        ],
        documentManifestHistory: [
          previous.documentManifest,
          ...previous.documentManifestHistory,
        ],
      };
      return response;
    },
    async submitUnlink(documentId, request) {
      input.submittedOperations.push("unlink");
      input.remoteRequests.push("unlink");
      if (!input.unlinkAvailable) {
        return null;
      }
      const response = await createLinkSetResponseFromRequest(
        documentId,
        request,
      );
      const previous = remote.writerProjection;
      remote.writerProjection = {
        authorizingContainerPaths: linkedProjections(request),
        contentKeyBundle: response.contentKeyBundle,
        documentContainerManifestHistory: [
          ...previous.documentContainerManifestHistory,
        ],
        documentId: response.id,
        documentKekTargets: response.documentKekTargets,
        documentManifest: response.accessManifest,
        documentManifestContainerPaths: [
          ...previous.documentManifestContainerPaths,
        ],
        documentManifestHistory: [
          previous.documentManifest,
          ...previous.documentManifestHistory,
        ],
      };
      return response;
    },
  };
  return remote;
}
