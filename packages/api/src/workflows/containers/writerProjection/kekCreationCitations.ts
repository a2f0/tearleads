import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import { loadContainerManifestBundleByHash } from "./accessPaths";
import { verifyStoredContainerManifest } from "./storedManifestVerification";
import type { ContainerWriterProjectionContext } from "./types";

/**
 * Verify the parent head each manifest's creation or move signed as its pin.
 * KEK verification reads that citation from the context, and a verification
 * marker accepts a stored manifest without walking the manifests it cites.
 */
export async function loadKekCreationCitations(
  context: ContainerWriterProjectionContext,
  manifests: readonly VerifiedContainerAccessManifest[],
): Promise<void> {
  for (const manifest of manifests) {
    const cited = manifest.state.parentManifestHash;
    if (!cited || context.verifiedManifestByHash.has(cited)) continue;
    await verifyStoredContainerManifest({
      bundle: await loadContainerManifestBundleByHash(context, cited),
      context,
      loadBundle: (hash) => loadContainerManifestBundleByHash(context, hash),
    });
  }
}
