import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { AccessManifest } from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import {
  getAccessManifestBundle,
  getAccessManifestBundles,
} from "../../access/read/accessManifestStore";
import { uniqueSortedStrings } from "../../utils/array";
import { toAccessManifestBundleWireResponse } from "./documentManifestBundle";
import {
  readContainerParentManifestHash,
  readEventDependencyManifestHashes,
  readManifestPreviousManifestHash,
} from "./writerProjectionBundleFields";
import { DocumentWriterProjectionError } from "./writerProjectionError";

/**
 * Loads the manifest dependencies a document writer projection serves: the
 * document's own history and every container path, predecessor, and cited
 * head the client needs to verify it.
 */
export interface LoadedProjectionManifestBundle {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly objectKind: AccessManifest["objectKind"];
}

export async function loadProjectionManifestBundleByHash(
  executor: DatabaseSession,
  manifestHash: string,
  cache: Map<string, LoadedProjectionManifestBundle>,
): Promise<LoadedProjectionManifestBundle> {
  const cached = cache.get(manifestHash);
  if (cached) {
    return cached;
  }

  const bundle = await getAccessManifestBundle(manifestHash, executor);
  if (!bundle) {
    throw new DocumentWriterProjectionError(
      "Access manifest dependency missing",
      409,
    );
  }

  const loaded = {
    bundle: toAccessManifestBundleWireResponse(bundle),
    objectKind: bundle.manifest.objectKind,
  };
  cache.set(manifestHash, loaded);

  return loaded;
}

async function loadProjectionManifestBundlesByHash(input: {
  readonly executor: DatabaseSession;
  readonly manifestHashes: readonly string[];
  readonly cache: Map<string, LoadedProjectionManifestBundle>;
}): Promise<LoadedProjectionManifestBundle[]> {
  const uniqueManifestHashes = uniqueSortedStrings(input.manifestHashes);
  const missingManifestHashes = uniqueManifestHashes.filter(
    (manifestHash) => !input.cache.has(manifestHash),
  );
  if (missingManifestHashes.length > 0) {
    const bundles = await getAccessManifestBundles(
      missingManifestHashes,
      input.executor,
    );
    for (const manifestHash of missingManifestHashes) {
      const bundle = bundles.get(manifestHash);
      if (!bundle) {
        throw new DocumentWriterProjectionError(
          "Access manifest dependency missing",
          409,
        );
      }

      input.cache.set(manifestHash, {
        bundle: toAccessManifestBundleWireResponse(bundle),
        objectKind: bundle.manifest.objectKind,
      });
    }
  }

  const loadedBundles: LoadedProjectionManifestBundle[] = [];
  for (const manifestHash of uniqueManifestHashes) {
    const loaded = input.cache.get(manifestHash);
    if (!loaded) {
      throw new DocumentWriterProjectionError(
        "Access manifest dependency missing",
        409,
      );
    }
    loadedBundles.push(loaded);
  }

  return loadedBundles;
}

function collectDocumentDependencyManifestHashes(
  bundles: readonly AccessManifestBundleWireResponse[],
): string[] {
  const manifestHashes = new Set<string>();
  for (const [index, bundle] of bundles.entries()) {
    for (const manifestHash of readEventDependencyManifestHashes(
      bundle,
      index === 0
        ? "Document writer projection manifest"
        : `Document writer projection manifest history[${index - 1}]`,
    )) {
      manifestHashes.add(manifestHash);
    }
  }

  return [...manifestHashes].sort();
}

export async function loadDocumentManifestHistory(input: {
  readonly documentManifest: AccessManifestBundleWireResponse;
  readonly executor: DatabaseSession;
  readonly manifestCache: Map<string, LoadedProjectionManifestBundle>;
}): Promise<AccessManifestBundleWireResponse[]> {
  const documentManifestHistory: AccessManifestBundleWireResponse[] = [];
  const visitedDocumentHashes = new Set([input.documentManifest.manifestHash]);
  let previousDocumentManifestHash = readManifestPreviousManifestHash(
    input.documentManifest,
    "Document writer projection manifest",
  );
  while (previousDocumentManifestHash) {
    if (visitedDocumentHashes.has(previousDocumentManifestHash)) {
      throw new DocumentWriterProjectionError(
        "Document manifest history contains a cycle",
        409,
      );
    }
    visitedDocumentHashes.add(previousDocumentManifestHash);
    const loaded = await loadProjectionManifestBundleByHash(
      input.executor,
      previousDocumentManifestHash,
      input.manifestCache,
    );
    if (loaded.objectKind !== "document") {
      throw new DocumentWriterProjectionError(
        "Document manifest predecessor has the wrong object kind",
        409,
      );
    }
    documentManifestHistory.push(loaded.bundle);
    previousDocumentManifestHash = readManifestPreviousManifestHash(
      loaded.bundle,
      "Document writer projection manifest history",
    );
  }

  return documentManifestHistory;
}

interface ContainerDependencyMaterial {
  readonly documentContainerManifestHistory: AccessManifestBundleWireResponse[];
  readonly documentManifestContainerPaths: AccessManifestBundleWireResponse[][];
}

export interface ContainerDependencyLoadState {
  readonly containerHistoryByHash: Map<
    string,
    AccessManifestBundleWireResponse
  >;
  readonly containerPathsByLeafHash: Map<
    string,
    AccessManifestBundleWireResponse[]
  >;
  readonly executor: DatabaseSession;
  readonly manifestCache: Map<string, LoadedProjectionManifestBundle>;
  readonly walkedCitations: Set<string>;
  readonly walkedContainerPredecessors: Set<string>;
}

async function loadContainerHistoryBundle(
  state: ContainerDependencyLoadState,
  manifestHash: string,
): Promise<AccessManifestBundleWireResponse> {
  const loaded = await loadProjectionManifestBundleByHash(
    state.executor,
    manifestHash,
    state.manifestCache,
  );
  if (loaded.objectKind !== "container") {
    throw new DocumentWriterProjectionError(
      "Container manifest history entry has the wrong object kind",
      409,
    );
  }
  state.containerHistoryByHash.set(loaded.bundle.manifestHash, loaded.bundle);
  return loaded.bundle;
}

/**
 * A container event cites the ancestor heads it was committed against, which
 * may be neither on the current path nor any manifest's pin once the parent
 * advanced or the container moved. The client authorizes the event against
 * those cited heads, so every history manifest's citations are served too,
 * along with their own predecessors and citations.
 */
async function collectContainerCitedHeads(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly state: ContainerDependencyLoadState;
}): Promise<void> {
  const pending = readEventDependencyManifestHashes(
    input.bundle,
    "Document writer projection container dependency",
  ).filter((manifestHash) => !input.state.walkedCitations.has(manifestHash));
  for (const manifestHash of pending) {
    input.state.walkedCitations.add(manifestHash);
    const bundle =
      input.state.containerHistoryByHash.get(manifestHash) ??
      (await loadContainerHistoryBundle(input.state, manifestHash));
    await collectContainerDependencyPredecessors({
      bundle,
      state: input.state,
    });
    await collectContainerCitedHeads({ bundle, state: input.state });
  }
}

async function collectContainerDependencyPredecessors(input: {
  readonly bundle: AccessManifestBundleWireResponse;
  readonly state: ContainerDependencyLoadState;
}): Promise<void> {
  let previousHash = readManifestPreviousManifestHash(
    input.bundle,
    "Document writer projection container dependency",
  );
  while (
    previousHash &&
    !input.state.walkedContainerPredecessors.has(previousHash)
  ) {
    input.state.walkedContainerPredecessors.add(previousHash);
    const bundle = await loadContainerHistoryBundle(input.state, previousHash);
    await collectContainerCitedHeads({ bundle, state: input.state });
    previousHash = readManifestPreviousManifestHash(
      bundle,
      "Document writer projection container dependency history",
    );
  }
}

export async function loadContainerDependencyPath(input: {
  readonly leafManifestHash: string;
  readonly state: ContainerDependencyLoadState;
}): Promise<void> {
  if (input.state.containerPathsByLeafHash.has(input.leafManifestHash)) {
    return;
  }

  const visitedPathHashes = new Set<string>();
  const path: AccessManifestBundleWireResponse[] = [];
  let manifestHash: string | null = input.leafManifestHash;
  while (manifestHash) {
    if (visitedPathHashes.has(manifestHash)) {
      throw new DocumentWriterProjectionError(
        "Container manifest path contains a cycle",
        409,
      );
    }
    visitedPathHashes.add(manifestHash);
    const loaded = await loadProjectionManifestBundleByHash(
      input.state.executor,
      manifestHash,
      input.state.manifestCache,
    );
    if (loaded.objectKind !== "container") {
      throw new DocumentWriterProjectionError(
        "Document manifest dependency has the wrong object kind",
        409,
      );
    }
    path.push(loaded.bundle);
    input.state.containerHistoryByHash.set(
      loaded.bundle.manifestHash,
      loaded.bundle,
    );
    await collectContainerDependencyPredecessors({
      bundle: loaded.bundle,
      state: input.state,
    });
    await collectContainerCitedHeads({
      bundle: loaded.bundle,
      state: input.state,
    });
    manifestHash = readContainerParentManifestHash(
      loaded.bundle,
      "Document writer projection container dependency",
    );
  }

  input.state.containerPathsByLeafHash.set(
    input.leafManifestHash,
    path.reverse(),
  );
}

export async function loadDocumentContainerDependencyMaterial(input: {
  readonly additionalDependencyManifestHashes?: readonly string[];
  readonly documentManifest: AccessManifestBundleWireResponse;
  readonly documentManifestHistory: readonly AccessManifestBundleWireResponse[];
  readonly executor: DatabaseSession;
  readonly manifestCache: Map<string, LoadedProjectionManifestBundle>;
}): Promise<ContainerDependencyMaterial> {
  const state: ContainerDependencyLoadState = {
    containerHistoryByHash: new Map<string, AccessManifestBundleWireResponse>(),
    containerPathsByLeafHash: new Map<
      string,
      AccessManifestBundleWireResponse[]
    >(),
    executor: input.executor,
    manifestCache: input.manifestCache,
    walkedCitations: new Set<string>(),
    walkedContainerPredecessors: new Set<string>(),
  };
  const documentBundles = [
    input.documentManifest,
    ...input.documentManifestHistory,
  ];
  const dependencies = await loadProjectionManifestBundlesByHash({
    cache: input.manifestCache,
    executor: input.executor,
    manifestHashes: uniqueSortedStrings([
      ...collectDocumentDependencyManifestHashes(documentBundles),
      ...(input.additionalDependencyManifestHashes ?? []),
    ]),
  });

  for (const dependency of dependencies) {
    if (dependency.objectKind === "container") {
      await loadContainerDependencyPath({
        leafManifestHash: dependency.bundle.manifestHash,
        state,
      });
    }
  }

  return {
    documentManifestContainerPaths: [
      ...state.containerPathsByLeafHash.values(),
    ],
    documentContainerManifestHistory: [
      ...state.containerHistoryByHash.values(),
    ],
  };
}
