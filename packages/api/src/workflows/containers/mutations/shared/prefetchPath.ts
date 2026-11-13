import type { ContainerManifestRef } from "@tearleads/validators/request";
import {
  getAccessManifestBundles,
  getCurrentAccessManifestHeads,
} from "../../../../access/read/accessManifestStore";
import { toManifestBundleResponse } from "../../writerProjection/records";
import type { ContainerMutationContext } from "../types";

/** Recalled after the lock boundary clears mutable heads; no negative caching. */
export async function prefetchMutationPath(
  context: ContainerMutationContext,
  refs: readonly ContainerManifestRef[],
): Promise<void> {
  const projection = context.writerProjectionContext;
  const hashes = refs
    .map((ref) => ref.manifestHash)
    .filter(
      (hash) =>
        !context.verifiedManifestByHash.has(hash) &&
        !projection.manifestBundleByHash.has(hash),
    );
  const bundles = await getAccessManifestBundles(
    hashes,
    context.executor,
    true,
  );
  for (const [hash, bundle] of bundles) {
    if (bundle.manifest.objectKind !== "container") continue;
    try {
      projection.manifestBundleByHash.set(
        hash,
        Promise.resolve(toManifestBundleResponse(bundle)),
      );
      projection.verificationMarkers.seed(bundle);
    } catch {
      // Let the referenced walk raise the original error in reference order.
    }
  }
  const ids = refs
    .map((ref) => ref.containerId)
    .filter((id) => !context.manifestHeadByContainerId.has(id));
  const heads = await getCurrentAccessManifestHeads(
    "container",
    ids,
    context.executor,
  );
  for (const [id, head] of heads)
    context.manifestHeadByContainerId.set(id, head);
}
