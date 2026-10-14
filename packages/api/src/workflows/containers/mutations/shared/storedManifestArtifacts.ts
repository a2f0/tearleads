import type { VerifiedContainerAccessManifest } from "@tearleads/crypto";
import type { ContainerManifestRef } from "@tearleads/validators/request";
import { loadContainerManifestBundleByHash } from "../../writerProjection/accessPaths";
import { verifyStoredContainerManifest } from "../../writerProjection/storedManifestVerification";
import { ContainerWriterProjectionError } from "../../writerProjection/types";
import { ContainerMutationError } from "../errors";
import type { ContainerMutationContext } from "../types";

function assertReferencedContainer(
  ref: ContainerManifestRef,
  manifest: VerifiedContainerAccessManifest,
  label: string,
): VerifiedContainerAccessManifest {
  // The cited containerId is advisory; reject a confused reference before any
  // head lookup authorizes against a container the request did not name.
  if (manifest.state.containerId !== ref.containerId) {
    throw new ContainerMutationError(
      `${label} container id does not match the referenced manifest`,
      409,
    );
  }
  return manifest;
}

/**
 * Resolve a cited container manifest from the server's own artifacts, never
 * from request bytes: first a manifest an earlier mutation of this batch
 * verified, then the stored bundle, which is re-verified because database
 * contents are not a trust boundary. Callers still pin the result to the
 * current head where freshness matters.
 */
export async function resolveVerifiedStoredContainerManifest(
  context: ContainerMutationContext,
  ref: ContainerManifestRef,
  label: string,
): Promise<VerifiedContainerAccessManifest> {
  const batchManifest = context.verifiedManifestByHash.get(ref.manifestHash);
  if (batchManifest) {
    return assertReferencedContainer(ref, batchManifest, label);
  }
  try {
    const storedBundle = await loadContainerManifestBundleByHash(
      context.writerProjectionContext,
      ref.manifestHash,
    );
    const storedManifest = await verifyStoredContainerManifest({
      bundle: storedBundle,
      context: context.writerProjectionContext,
      loadBundle: (manifestHash) =>
        loadContainerManifestBundleByHash(
          context.writerProjectionContext,
          manifestHash,
        ),
    });
    return assertReferencedContainer(ref, storedManifest, label);
  } catch (error) {
    if (!(error instanceof ContainerWriterProjectionError)) {
      throw error;
    }
    throw new ContainerMutationError(
      `${label} is not a verified stored manifest: ${error.message}`,
      409,
    );
  }
}
