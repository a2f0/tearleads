import type {
  ContainerKekResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";

/**
 * A write path cites a retired ancestor key epoch. Retryable: this writer's
 * next sync pass, or a peer, re-keys the stale container parent-first.
 */
export class ContainerKekRepairRequiredError extends Error {
  constructor(
    readonly containerId: string,
    message = `Container write requires ancestor KEK repair for ${containerId}`,
  ) {
    super(message);
    this.name = "ContainerKekRepairRequiredError";
  }
}

/**
 * The stale container is one this writer cannot re-key: it holds no key for it
 * or lacks write access on its path. It must not be handed that key either — a
 * stale container's KEK may be held by a revoked ancestor member — so the
 * repair belongs to a member with access at or above the container, normally
 * the device that rotated the ancestor. Queued writes wait for that repair.
 */
export class ContainerKekRepairInaccessibleError extends ContainerKekRepairRequiredError {
  constructor(containerId: string) {
    super(
      containerId,
      `Container ${containerId} needs a key repair from a member with access to it; queued changes sync afterwards`,
    );
    this.name = "ContainerKekRepairInaccessibleError";
  }
}

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
      throw new ContainerKekRepairRequiredError(kek.containerId);
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
