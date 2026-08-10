import type { ContainerState } from "../../workflows/container-contents/remoteHydration";

export function isRemoteBackedContainerState(
  containerState: ContainerState,
): boolean {
  return (
    typeof containerState.container.metadataDocumentId === "string" &&
    containerState.container.metadataDocumentId.length > 0 &&
    typeof containerState.record.documentId === "string" &&
    containerState.record.documentId.length > 0 &&
    typeof containerState.record.accessStateHash === "string" &&
    containerState.record.accessStateHash.length > 0
  );
}
