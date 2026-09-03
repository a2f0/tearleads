import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
  isGetContainerWriterProjectionOperationResponse,
  isGetDocumentWriterProjectionOperationResponse,
  operationRequestPath,
} from "@tearleads/validators/operation";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";

// A writer projection is consumed by its leaf: callers wrap keys under
// whatever container or document the response describes. Binding the
// validator to the requested id makes a projection for any other object an
// invalid response, so a server cannot redirect a create, move, share, rekey,
// or content-key re-wrap onto an object it substituted. The top-level id is a
// mutable label, so the binding also covers the hash-committed manifest object
// id, the manifest state the SDK later verifies, and the nested KEK and
// content-key bundle ids a relabeled projection would still carry.
function manifestDescribes(
  bundle: { manifest: Record<string, unknown>; state: Record<string, unknown> },
  stateKey: "containerId" | "documentId",
  id: string,
): boolean {
  return (
    Reflect.get(bundle.manifest, "objectId") === id &&
    Reflect.get(bundle.state, stateKey) === id
  );
}

function containerProjectionDescribes(
  projection: ContainerWriterProjectionResponse,
  containerId: string,
): boolean {
  const leaf = projection.path.at(-1);
  return (
    projection.containerId === containerId &&
    leaf !== undefined &&
    manifestDescribes(leaf, "containerId", containerId) &&
    projection.containerKeks.at(-1)?.containerId === containerId
  );
}

export const containerWriterProjection = {
  isResponseFor(containerId: string) {
    return (value: unknown): value is ContainerWriterProjectionResponse =>
      isGetContainerWriterProjectionOperationResponse(value) &&
      containerProjectionDescribes(value, containerId);
  },
  method: getContainerWriterProjectionOperation.method,
  path(containerId: string) {
    return operationRequestPath(getContainerWriterProjectionOperation, {
      containerId,
    });
  },
};

export const documentWriterProjection = {
  // The authorizing container paths carry no requested id, but each must at
  // least describe the container it labels itself with, so a substituted
  // path cannot smuggle another container's leaf under a relabeled id.
  isResponseFor(documentId: string) {
    return (value: unknown): value is DocumentWriterProjectionResponse =>
      isGetDocumentWriterProjectionOperationResponse(value) &&
      value.documentId === documentId &&
      manifestDescribes(value.documentManifest, "documentId", documentId) &&
      value.documentKekTargets.documentId === documentId &&
      value.contentKeyBundle.documentId === documentId &&
      value.authorizingContainerPaths.every((projection) =>
        containerProjectionDescribes(projection, projection.containerId),
      );
  },
  method: getDocumentWriterProjectionOperation.method,
  path(documentId: string) {
    return operationRequestPath(getDocumentWriterProjectionOperation, {
      documentId,
    });
  },
};
