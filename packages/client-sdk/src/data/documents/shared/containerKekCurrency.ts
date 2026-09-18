import type {
  ContainerKekResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";

/** Recovery can open retired keys; new ciphertext must not use their stale descendants. */
export function assertContainerKekPathCurrent(
  keks: readonly Pick<
    ContainerKekResponse,
    "containerId" | "containerKeyEpochId" | "parentContainerKeyEpochId"
  >[],
): void {
  for (const [index, kek] of keks.entries()) {
    const expectedParentEpoch =
      index === 0 ? null : keks[index - 1]?.containerKeyEpochId;
    if (kek.parentContainerKeyEpochId !== expectedParentEpoch) {
      throw new Error(
        `Container write requires ancestor KEK repair for ${kek.containerId}`,
      );
    }
  }
}

export function assertDocumentKekPathsCurrent(
  projection: DocumentWriterProjectionResponse,
  containerIds?: ReadonlySet<string>,
): void {
  for (const path of projection.authorizingContainerPaths) {
    if (!containerIds || containerIds.has(path.containerId)) {
      assertContainerKekPathCurrent(path.containerKeks);
    }
  }
}
