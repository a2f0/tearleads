import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
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

export interface DocumentPurgeAuthorizationMaterial {
  readonly authorizingContainerPath: AccessManifestBundleWireResponse[];
  readonly authorizingContainerManifestHistory: AccessManifestBundleWireResponse[];
}

interface DocumentPurgeProofMaterial
  extends DocumentPurgeAuthorizationMaterial {
  readonly documentContainerManifestHistory: AccessManifestBundleWireResponse[];
  readonly documentManifest: AccessManifestBundleWireResponse;
  readonly documentManifestContainerPaths: AccessManifestBundleWireResponse[][];
  readonly documentManifestHistory: AccessManifestBundleWireResponse[];
}

async function loadDocumentPurgeAuthorizationMaterialWithCache(input: {
  readonly authorizingContainerManifestHashes: readonly string[];
  readonly executor: DatabaseSession;
  readonly manifestCache: Map<string, LoadedProjectionManifestBundle>;
}): Promise<DocumentPurgeAuthorizationMaterial> {
  const state: ContainerDependencyLoadState = {
    containerHistoryByHash: new Map(),
    containerPathsByLeafHash: new Map(),
    executor: input.executor,
    manifestCache: input.manifestCache,
    walkedContainerPredecessors: new Set(),
  };
  const authorizingContainerPath: AccessManifestBundleWireResponse[] = [];
  for (const manifestHash of input.authorizingContainerManifestHashes) {
    await loadContainerDependencyPath({
      leafManifestHash: manifestHash,
      state,
    });
    const loaded = await loadProjectionManifestBundleByHash(
      input.executor,
      manifestHash,
      input.manifestCache,
    );
    if (loaded.objectKind !== "container") {
      throw new DocumentWriterProjectionError(
        "Document purge authorization path has the wrong object kind",
        409,
      );
    }
    authorizingContainerPath.push(loaded.bundle);
  }
  return {
    authorizingContainerPath,
    authorizingContainerManifestHistory: [
      ...state.containerHistoryByHash.values(),
    ],
  };
}

export function loadDocumentPurgeAuthorizationMaterial(input: {
  readonly authorizingContainerManifestHashes: readonly string[];
  readonly executor: DatabaseSession;
}): Promise<DocumentPurgeAuthorizationMaterial> {
  return loadDocumentPurgeAuthorizationMaterialWithCache({
    ...input,
    manifestCache: new Map(),
  });
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
  readonly authorizationMaterial?:
    | DocumentPurgeAuthorizationMaterial
    | undefined;
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
  const authorizationMaterial =
    input.authorizationMaterial ??
    (await loadDocumentPurgeAuthorizationMaterialWithCache({
      authorizingContainerManifestHashes:
        input.authorizingContainerManifestHashes,
      executor: input.executor,
      manifestCache,
    }));
  const containerHistoryByHash = new Map(
    documentDependencies.documentContainerManifestHistory.map((bundle) => [
      bundle.manifestHash,
      bundle,
    ]),
  );
  for (const bundle of authorizationMaterial.authorizingContainerManifestHistory) {
    containerHistoryByHash.set(bundle.manifestHash, bundle);
  }
  return {
    authorizingContainerPath: authorizationMaterial.authorizingContainerPath,
    authorizingContainerManifestHistory:
      authorizationMaterial.authorizingContainerManifestHistory,
    documentContainerManifestHistory: [...containerHistoryByHash.values()],
    documentManifest: documentManifest.bundle,
    documentManifestContainerPaths:
      documentDependencies.documentManifestContainerPaths,
    documentManifestHistory,
  };
}
