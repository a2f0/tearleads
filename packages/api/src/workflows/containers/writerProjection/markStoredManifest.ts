import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { databaseVerificationMarkerStore } from "../../../utils/accessManifestVerificationMarkers";
import { loadContainerManifestBundleByHash } from "./accessPaths";
import { createContainerWriterProjectionContext } from "./context";
import { verifyStoredContainerManifest } from "./storedManifestVerification";
import type { ContainerWriterProjectionContext } from "./types";

/**
 * A verification context whose markers are written. Only a transaction that
 * just stored a manifest under its organization lock may use one.
 */
export function createMarkingVerificationContext(
  executor: DatabaseSession,
): ContainerWriterProjectionContext {
  return {
    ...createContainerWriterProjectionContext(executor),
    verificationMarkers: databaseVerificationMarkerStore(executor, {
      record: true,
    }),
  };
}

/**
 * Run the stored-history verifier over a container manifest this transaction
 * just stored and mark it, together with any unmarked history it depends on.
 * Reads never write markers, so every new head is marked here; a manifest the
 * stored verifier would refuse is refused at write time instead.
 */
export async function markStoredContainerManifest(
  executor: DatabaseSession,
  manifestHash: string,
): Promise<void> {
  const context = createMarkingVerificationContext(executor);
  const bundle = await loadContainerManifestBundleByHash(context, manifestHash);
  await verifyStoredContainerManifest({
    bundle,
    context,
    loadBundle: (hash) => loadContainerManifestBundleByHash(context, hash),
  });
  await context.verificationMarkers.flush?.();
}
