import type {
  AccessManifestBundleWireResponse,
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@symcrypt/validators/response";

export function writerProjectionEvidence(
  projections: readonly ContainerWriterProjectionResponse[],
  documentManifestHistory: readonly AccessManifestBundleWireResponse[],
): Pick<
  DocumentWriterProjectionResponse,
  | "documentContainerManifestHistory"
  | "documentManifestContainerPaths"
  | "documentManifestHistory"
> {
  const containerHistoryByHash = new Map<
    string,
    AccessManifestBundleWireResponse
  >();
  for (const projection of projections) {
    for (const bundle of [
      ...projection.path,
      ...projection.containerKeks.flatMap(
        (kek) => kek.containerManifestHistory,
      ),
    ]) {
      containerHistoryByHash.set(bundle.manifestHash, bundle);
    }
  }

  return {
    documentContainerManifestHistory: [...containerHistoryByHash.values()],
    documentManifestContainerPaths: projections.map((projection) => [
      ...projection.path,
    ]),
    documentManifestHistory: [...documentManifestHistory],
  };
}
