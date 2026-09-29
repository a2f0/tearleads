import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { loadContainerManifestBundleByHash } from "./accessPaths";
import { createContainerWriterProjectionContext } from "./context";
import { verifyStoredContainerManifest } from "./storedManifestVerification";

/**
 * Run the stored-history verifier over a container manifest this transaction
 * just stored, and write its marker with any unmarked history it depends on.
 * Callers hold the organization lock, so marker writes for one organization's
 * containers are serialized. A manifest the stored verifier would refuse is
 * refused at write time instead of on a later read.
 */
export async function markStoredContainerManifest(
  executor: DatabaseSession,
  manifestHash: string,
): Promise<void> {
  const context = createContainerWriterProjectionContext(executor);
  const bundle = await loadContainerManifestBundleByHash(context, manifestHash);
  await verifyStoredContainerManifest({
    bundle,
    context,
    loadBundle: (hash) => loadContainerManifestBundleByHash(context, hash),
  });
  await context.verificationMarkers.flush?.();
}
