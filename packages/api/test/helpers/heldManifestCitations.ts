import type {
  HeldProjectionCitation,
  VerifiedManifestCitations,
} from "@tearleads/api-client";
import {
  type AccessManifestBundleWireResponse,
  type ContainerKeyingPathResponse,
  containerKekWireLevel,
  type DocumentWriterProjectionResponse,
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
 * a projection's bundles and KEK levels only after the SDK verified that
 * projection. `levels: false` holds bundles alone.
 */
export function createHeldManifestCitations(
  options: { levels?: boolean } = {},
) {
  const held = new Map<string, HeldProjectionCitation>();
  const hold = (bundles: readonly AccessManifestBundleWireResponse[]) => {
    for (const bundle of bundles) held.set(bundle.manifestHash, bundle);
  };
  const holdLevels = (paths: readonly ContainerKeyingPathResponse[]) => {
    if (options.levels === false) return;
    for (const path of paths)
      for (const kek of path.containerKeks)
        held.set(`level:${kek.containerId}`, containerKekWireLevel(kek));
  };
  const citations: VerifiedManifestCitations = {
    // Levels first, as the device's own source cites them.
    cite: async () =>
      [...held.entries()]
        .sort(
          ([left], [right]) =>
            Number(right.startsWith("level:")) -
            Number(left.startsWith("level:")),
        )
        .map(([, citation]) => citation),
  };
  return {
    citations,
    holdContainer: (projection: ContainerKeyingPathResponse) => {
      hold(keyingPathBundles(projection));
      holdLevels([projection]);
    },
    holdDocument: (projection: DocumentWriterProjectionResponse) => {
      holdLevels(projection.authorizingContainerPaths);
      hold([
        projection.documentManifest,
        ...projection.documentManifestHistory,
        ...projection.documentContainerManifestHistory,
        ...projection.documentManifestContainerPaths.flat(),
        ...projection.authorizingContainerPaths.flatMap(keyingPathBundles),
      ]);
    },
  };
}
