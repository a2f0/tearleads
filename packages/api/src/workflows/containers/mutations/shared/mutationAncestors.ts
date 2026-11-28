import type {
  AccessEventType,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";

export interface ContainerMutationAncestors {
  /** Root to parent of the container after the mutation (`[]` for a root). */
  readonly ancestorIds: readonly string[];
  /**
   * Root to the container's previous parent on a move (`undefined` when the
   * mutation is not a move or the container previously had no parent).
   */
  readonly previousAncestorIds?: readonly string[] | undefined;
}

function pathContainerIds(
  path: readonly VerifiedContainerAccessManifest[] | undefined,
): string[] {
  return (path ?? []).map((manifest) => manifest.state.containerId);
}

/**
 * Derives server-only realtime routing ancestors from the container paths a
 * mutation workflow already verified, with zero extra database reads.
 */
export function deriveContainerMutationAncestors(input: {
  readonly destinationParentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly eventType: AccessEventType;
  readonly parentContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
  readonly previousContainerPath:
    | readonly VerifiedContainerAccessManifest[]
    | undefined;
}): ContainerMutationAncestors {
  if (input.eventType === "container.create") {
    return { ancestorIds: pathContainerIds(input.parentContainerPath) };
  }
  const previousAncestors = pathContainerIds(input.previousContainerPath).slice(
    0,
    -1,
  );
  if (input.eventType === "container.move") {
    return {
      ancestorIds: pathContainerIds(input.destinationParentContainerPath),
      ...(previousAncestors.length > 0
        ? { previousAncestorIds: previousAncestors }
        : {}),
    };
  }
  return { ancestorIds: previousAncestors };
}
