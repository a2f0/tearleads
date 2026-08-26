import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import type { AccessManifestBundleWireResponse } from "@symcrypt/validators/response";
import { getCurrentAccessManifestHead } from "../../access/read/accessManifestStore";
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

export async function loadAuthorizingContainerCheckpointMaterial(input: {
  readonly containerIds: readonly string[];
  readonly executor: DatabaseSession;
}): Promise<{
  readonly heads: AccessManifestBundleWireResponse[];
  readonly history: AccessManifestBundleWireResponse[];
}> {
  const manifestCache = new Map<string, LoadedProjectionManifestBundle>();
  const state: ContainerDependencyLoadState = {
    containerHistoryByHash: new Map(),
    containerPathsByLeafHash: new Map(),
    executor: input.executor,
    manifestCache,
    walkedContainerPredecessors: new Set(),
  };
  const heads: AccessManifestBundleWireResponse[] = [];

  for (const containerId of input.containerIds) {
    const head = await getCurrentAccessManifestHead(
      "container",
      containerId,
      input.executor,
    );
    if (!head) {
      throw new DocumentWriterProjectionError(
        "Document purge authorization checkpoint head is missing",
        409,
      );
    }
    await loadContainerDependencyPath({
      leafManifestHash: head.manifestHash,
      state,
    });
    const loaded = await loadProjectionManifestBundleByHash(
      input.executor,
      head.manifestHash,
      manifestCache,
    );
    if (loaded.objectKind !== "container") {
      throw new DocumentWriterProjectionError(
        "Document purge authorization checkpoint has the wrong object kind",
        409,
      );
    }
    heads.push(loaded.bundle);
  }

  return {
    heads,
    history: [...state.containerHistoryByHash.values()],
  };
}

export async function loadDocumentPurgeProofMaterial(input: {
  readonly authorizingContainerManifestHashes: readonly string[];
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
  const authorizingContainerPath: AccessManifestBundleWireResponse[] = [];
  for (const manifestHash of input.authorizingContainerManifestHashes) {
    await loadContainerDependencyPath({
      leafManifestHash: manifestHash,
      state: authorizingState,
    });
    const loaded = await loadProjectionManifestBundleByHash(
      input.executor,
      manifestHash,
      manifestCache,
    );
    if (loaded.objectKind !== "container") {
      throw new DocumentWriterProjectionError(
        "Document purge authorization path has the wrong object kind",
        409,
      );
    }
    authorizingContainerPath.push(loaded.bundle);
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
