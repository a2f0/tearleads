import {
  type ContainerWriterProjectionResponse,
  type DocumentWriterProjectionResponse,
  deriveDecodedProjection,
} from "@tearleads/validators/response";

/** Document paths share the one proof carried by their enclosing projection. */
export function documentContainerProjections(
  document: DocumentWriterProjectionResponse,
): ContainerWriterProjectionResponse[] {
  return document.authorizingContainerPaths.map((path) =>
    deriveDecodedProjection(document, {
      ...path,
      policyEvidence: document.policyEvidence,
    }),
  );
}
