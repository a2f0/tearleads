import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import type { ReferencedPrincipalHead } from "@symcrypt/crypto";
import type { AccessManifestBundleWireResponse } from "@symcrypt/validators/response";
import { readProjectionAccessManifest } from "../../keyingProjectionRecords";
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
  readonly authorizingContainerManifestHistory: AccessManifestBundleWireResponse[];
  readonly documentContainerManifestHistory: AccessManifestBundleWireResponse[];
  readonly documentManifest: AccessManifestBundleWireResponse;
  readonly documentManifestContainerPaths: AccessManifestBundleWireResponse[][];
  readonly documentManifestHistory: AccessManifestBundleWireResponse[];
}

export function collectPurgeProofPrincipalReferences(
  bundles: readonly AccessManifestBundleWireResponse[],
): ReferencedPrincipalHead[] {
  const references = new Map<string, ReferencedPrincipalHead>();
  for (const [index, bundle] of bundles.entries()) {
    const manifest = readProjectionAccessManifest(
      bundle.manifest,
      `Document purge proof manifest[${index}]`,
      (message) => new DocumentWriterProjectionError(message, 409),
    );
    for (const reference of manifest.referencedPrincipalHeads) {
      references.set(
        [
          reference.principalType,
          reference.principalId,
          reference.version,
          reference.keyEpoch,
          reference.stateHash,
          reference.keyFingerprint,
        ].join(":"),
        reference,
      );
    }
  }
  return [...references.values()];
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
    authorizingContainerManifestHistory: [
      ...authorizingState.containerHistoryByHash.values(),
    ],
    documentContainerManifestHistory: [...containerHistoryByHash.values()],
    documentManifest: documentManifest.bundle,
    documentManifestContainerPaths:
      documentDependencies.documentManifestContainerPaths,
    documentManifestHistory,
  };
}
