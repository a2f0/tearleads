import { throwVerification } from "./shared";
import type { VerifiedContainerAccessManifest } from "./types";

/** Validate topology before combining grants from individually verified heads. */
export function assertContainerPathIntegrity(
  path: readonly VerifiedContainerAccessManifest[],
  label: string,
): void {
  const root = path[0];
  // An empty path carries no authority; callers requiring a path reject it.
  if (!root) return;
  if (
    root.state.parentContainerId !== null ||
    root.state.parentManifestHash !== null
  ) {
    throwVerification(
      "missing_dependency",
      `${label} path must start at a root`,
    );
  }
  const seen = new Set<string>();
  for (const [index, manifest] of path.entries()) {
    if (manifest.state.organizationId !== root.state.organizationId) {
      throwVerification(
        "object_mismatch",
        `${label} path crosses organizations`,
      );
    }
    const parent = path[index - 1];
    if (
      seen.has(manifest.state.containerId) ||
      (parent && manifest.state.parentContainerId !== parent.state.containerId)
    ) {
      throwVerification(
        "missing_dependency",
        `${label} path is not contiguous`,
      );
    }
    seen.add(manifest.state.containerId);
  }
  // Do not compare creation-time parent hashes to served heads: an ancestor
  // can advance while a descendant retains its older signed citation (F1).
}

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
