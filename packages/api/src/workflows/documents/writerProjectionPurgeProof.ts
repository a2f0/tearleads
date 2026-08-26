import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import type { AccessManifestBundleWireResponse } from "@symcrypt/validators/response";
import {
  type ContainerDependencyLoadState,
  DocumentWriterProjectionError,
  type LoadedProjectionManifestBundle,
  loadContainerDependencyPath,
  loadDocumentContainerDependencyMaterial,
  loadDocumentManifestHistory,
  loadProjectionManifestBundleByHash,
} from "./writerProjection";

interface DocumentPurgeProofMaterial {
  readonly authorizingContainerPath: AccessManifestBundleWireResponse[];
  readonly documentContainerManifestHistory: AccessManifestBundleWireResponse[];
  readonly documentManifest: AccessManifestBundleWireResponse;
  readonly documentManifestContainerPaths: AccessManifestBundleWireResponse[][];
  readonly documentManifestHistory: AccessManifestBundleWireResponse[];
}

export async function loadDocumentPurgeProofMaterial(input: {
  readonly authorizingContainerManifestHash: string;
  readonly documentManifestHash: string;
  readonly executor: DatabaseSession;
}): Promise<DocumentPurgeProofMaterial> {
  const manifestCache = new Map<string, LoadedProjectionManifestBundle>();
  const documentManifest = await loadProjectionManifestBundleByHash(
    input.executor,
    input.documentManifestHash,
    manifestCache,
  );
  if (documentManifest.objectKind !== "document") {
    throw new DocumentWriterProjectionError(
      "Document purge predecessor has the wrong object kind",
      409,
    );
  }
  const documentManifestHistory = await loadDocumentManifestHistory({
    documentManifest: documentManifest.bundle,
    executor: input.executor,
    manifestCache,
  });
  const documentDependencies = await loadDocumentContainerDependencyMaterial({
    documentManifest: documentManifest.bundle,
    documentManifestHistory,
    executor: input.executor,
    manifestCache,
  });
  const authorizingState: ContainerDependencyLoadState = {
    containerHistoryByHash: new Map(),
    containerPathsByLeafHash: new Map(),
    executor: input.executor,
    manifestCache,
    walkedContainerPredecessors: new Set(),
  };
  await loadContainerDependencyPath({
    leafManifestHash: input.authorizingContainerManifestHash,
    state: authorizingState,
  });
  const authorizingContainerPath =
    authorizingState.containerPathsByLeafHash.get(
      input.authorizingContainerManifestHash,
    );
  if (!authorizingContainerPath) {
    throw new DocumentWriterProjectionError(
      "Document purge authorization path is missing",
      409,
    );
  }
  const containerHistoryByHash = new Map(
    documentDependencies.documentContainerManifestHistory.map((bundle) => [
      bundle.manifestHash,
      bundle,
    ]),
  );
  for (const [
    manifestHash,
    bundle,
  ] of authorizingState.containerHistoryByHash) {
    containerHistoryByHash.set(manifestHash, bundle);
  }
  return {
    authorizingContainerPath,
    documentContainerManifestHistory: [...containerHistoryByHash.values()],
    documentManifest: documentManifest.bundle,
    documentManifestContainerPaths:
      documentDependencies.documentManifestContainerPaths,
    documentManifestHistory,
  };
}
