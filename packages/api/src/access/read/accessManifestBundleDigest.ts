import {
  type AnyVerifiedAccessManifest,
  computeAccessManifestBundleDigest,
} from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { toServedAccessManifestBundle } from "@tearleads/validators/util";
import {
  projectionAccessManifestRecord,
  projectionVerifiedAccessEventRecord,
} from "../../keyingProjectionRecords";
import { accessManifestState } from "../shared/internal/accessManifestJson";

/**
 * The citation digest of the bundle a writer projection serves for a stored
 * manifest: the same event, manifest and state records the projection reads
 * back from the store, in their served form. A mutation acknowledgement names
 * it so the author can hold exactly those bytes for later citation.
 */
export async function servedAccessManifestBundleDigest(
  manifest: AnyVerifiedAccessManifest,
): Promise<string> {
  const state: unknown = accessManifestState(manifest);
  if (!isPlainObject(state)) {
    throw new Error("Stored access manifest state is not a record");
  }
  const digest = await computeAccessManifestBundleDigest(
    toServedAccessManifestBundle({
      event: projectionVerifiedAccessEventRecord(manifest.event),
      manifest: projectionAccessManifestRecord(manifest.manifest),
      manifestHash: manifest.manifestHash,
      state,
    }),
  );
  if (digest === null) {
    throw new Error("Served access manifest bundle is not canonical JSON");
  }
  return digest;
}
