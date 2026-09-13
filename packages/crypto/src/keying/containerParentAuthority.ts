import { throwVerification } from "./shared";
import type { VerifiedContainerAccessManifest } from "./types";

export function requireContainerPathLast(
  path: readonly VerifiedContainerAccessManifest[] | undefined,
  label: string,
): VerifiedContainerAccessManifest {
  const lastManifest = path?.at(-1);
  if (!lastManifest) {
    throwVerification("missing_dependency", `${label} path is required`);
  }

  return lastManifest;
}

export function requireContainerPathCurrentParent(input: {
  readonly organizationId: string;
  readonly parentContainerId: string | null;
  readonly parentManifestHash: string | null;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly label: string;
}): void {
  if (!input.parentContainerId || !input.parentManifestHash) {
    throwVerification(
      "missing_dependency",
      `${input.label} parent manifest is required`,
    );
  }

  const parentManifest = requireContainerPathLast(input.path, input.label);
  if (
    input.path?.some(
      (head) => head.state.organizationId !== input.organizationId,
    )
  ) {
    throwVerification(
      "object_mismatch",
      `${input.label} parent path belongs to another organization`,
    );
  }
  if (
    parentManifest.state.containerId !== input.parentContainerId ||
    parentManifest.manifestHash !== input.parentManifestHash
  ) {
    throwVerification(
      "missing_dependency",
      `${input.label} parent manifest hash mismatch`,
    );
  }
}
