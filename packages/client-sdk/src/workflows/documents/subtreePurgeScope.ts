import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { readManifestContainerId } from "../../data/documents/shared/readers";

/** Check the exact verified path that the destructive request will cite. */
export function assertSubtreePurgePath(
  path: readonly AccessManifestBundleWireResponse[],
  rootContainerId: string | undefined,
): void {
  if (rootContainerId === undefined) return;
  if (
    !path.some((bundle) => readManifestContainerId(bundle) === rootContainerId)
  ) {
    // A valid move out of the selected subtree is ordinary concurrent work.
    throw new Error(
      "Document placement is outside the requested purge subtree",
    );
  }
}
