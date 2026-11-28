import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  PrincipalPolicyAuthorization,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import { containerAccessManifestStateRecord } from "../../../keyingProjectionRecords";
import { toManifestBundleResponse } from "./records";
import type { ContainerWriterProjectionContext } from "./types";
import { databaseVerificationMarkerStore } from "./verificationMarkers";

/**
 * Seeds container manifests already verified under this transaction's locks so
 * follow-up metadata-document and seed-sync checks skip redundant container
 * and manifest re-reads in the same transaction (#3396).
 */
export function seedVerifiedContainerManifestsInContext(
  context: ContainerWriterProjectionContext,
  manifests: readonly VerifiedContainerAccessManifest[],
): void {
  for (const manifest of manifests) {
    context.verifiedManifestByHash.set(manifest.manifestHash, manifest);
    context.liveContainerOrganizationById.set(
      manifest.state.containerId,
      manifest.state.organizationId,
    );
    context.containerPathRowById.set(
      manifest.state.containerId,
      Promise.resolve({
        id: manifest.state.containerId,
        organizationId: manifest.state.organizationId,
        parentId: manifest.state.parentContainerId,
      }),
    );
    const bundle = Promise.resolve(
      toManifestBundleResponse({
        event: manifest.event,
        manifest: manifest.manifest,
        manifestHash: manifest.manifestHash,
        state: containerAccessManifestStateRecord(manifest.state),
      }),
    );
    context.manifestBundleByHash.set(manifest.manifestHash, bundle);
    context.currentManifestBundleByContainerId.set(
      manifest.state.containerId,
      bundle,
    );
  }
}

export function createContainerWriterProjectionContext(
  executor: DatabaseSession,
  principalPolicyAuthorizationEvidence: readonly PrincipalPolicyAuthorization[] = [],
): ContainerWriterProjectionContext {
  return {
    keyEpochById: new Map(),
    keyWrapsByEpochId: new Map(),
    containerKekStateByCacheKey: new Map(),
    containerPathRowById: new Map(),
    liveContainerOrganizationById: new Map(),
    executor,
    currentManifestBundleByContainerId: new Map(),
    manifestBundleByHash: new Map(),
    principalPolicyAuthorizationEvidence,
    verifiedManifestByHash: new Map(),
    verificationMarkers: databaseVerificationMarkerStore(executor, {
      recordsMarkers: principalPolicyAuthorizationEvidence.length === 0,
    }),
    signerByUserId: new Map(),
    prefetchedHistoryContainerIds: new Set(),
    manifestLineageByHash: new Map(),
  };
}

export async function cachedProjectionValue<K, V>(
  cache: Map<K, Promise<V>>,
  key: K,
  load: () => Promise<V>,
): Promise<V> {
  const cachedValue = cache.get(key);
  if (cachedValue) {
    return cachedValue;
  }

  const loadedValue = load();
  cache.set(key, loadedValue);

  try {
    return await loadedValue;
  } catch (error) {
    if (cache.get(key) === loadedValue) {
      cache.delete(key);
    }
    throw error;
  }
}
