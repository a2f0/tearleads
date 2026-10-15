import type { VerifiedManifestCitations } from "@tearleads/api-client";
import type {
  AccessManifestBundleWireResponse,
  ContainerKeyingPathResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";

function keyingPathBundles(
  path: ContainerKeyingPathResponse,
): AccessManifestBundleWireResponse[] {
  return [
    ...path.path,
    ...path.containerKeks.flatMap((kek) => kek.containerManifestHistory),
  ];
}

/**
 * A device's durable verified-bundle table, reduced to memory: the test holds
 * a projection's bundles only after the SDK verified that projection.
 */
export function createHeldManifestCitations() {
  const held = new Map<string, AccessManifestBundleWireResponse>();
  const hold = (bundles: readonly AccessManifestBundleWireResponse[]) => {
    for (const bundle of bundles) held.set(bundle.manifestHash, bundle);
  };
  const citations: VerifiedManifestCitations = {
    cite: async () => [...held.values()],
  };
  return {
    citations,
    holdContainer: (projection: ContainerKeyingPathResponse) =>
      hold(keyingPathBundles(projection)),
    holdDocument: (projection: DocumentWriterProjectionResponse) =>
      hold([
        projection.documentManifest,
        ...projection.documentManifestHistory,
        ...projection.documentContainerManifestHistory,
        ...projection.documentManifestContainerPaths.flat(),
        ...projection.authorizingContainerPaths.flatMap(keyingPathBundles),
      ]),
  };
}
