import type {
  ContainerWriterProjectionResponse,
  DocumentCreateResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";

/**
 * Build the writer projection a document-create response establishes, from the
 * container projection the create was authored against plus the manifest,
 * content-key bundle, and KEK targets the server just returned. This is the
 * same material a cold `GET /documents/:id/writer-projection` would yield, so
 * seeding it lets the first read after a create resolve locally. Shared by the
 * plain document-create path and the container-with-metadata-document path,
 * whose response carries an equivalent `DocumentCreateResponse`.
 */
export function documentWriterProjectionFromCreateResponse(input: {
  containerProjection: ContainerWriterProjectionResponse;
  response: DocumentCreateResponse;
}): DocumentWriterProjectionResponse {
  return {
    policyEvidence: input.containerProjection.policyEvidence,
    authorizingContainerPaths: [input.containerProjection],
    contentKeyBundle: input.response.contentKeyBundle,
    documentContainerManifestHistory: [
      ...input.containerProjection.path,
      ...input.containerProjection.containerKeks.flatMap(
        (kek) => kek.containerManifestHistory,
      ),
    ],
    documentId: input.response.id,
    documentKekTargets: input.response.documentKekTargets,
    documentManifest: input.response.accessManifest,
    documentManifestContainerPaths: [[...input.containerProjection.path]],
    documentManifestHistory: [],
  };
}
