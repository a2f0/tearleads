import type { AccessManifestCheckpoint } from "@tearleads/crypto";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import {
  rememberVerifiedManifestBundles,
  type VerifiedManifestBundle,
} from "../persistence/verifiedManifestBundlePersistence";
import type { ExecSql } from "../sqlite/sqlSchema";
import type { ProjectionCheckpointContext } from "./checkpointContext";
import { projectionLifetimeGuard } from "./projectionLifetimes";
import { assertProjectionVerificationCurrent } from "./types";

/**
 * Pairs each served bundle with the manifest its verification produced. A
 * bundle the projection carried but verification never reached is skipped.
 */
export function verifiedProjectionBundles(
  bundlesByHash: ReadonlyMap<string, AccessManifestBundleWireResponse>,
  verifiedByHash: ReadonlyMap<
    string,
    { readonly checkpoint: AccessManifestCheckpoint }
  >,
): VerifiedManifestBundle[] {
  return [...bundlesByHash].flatMap(([manifestHash, bundle]) => {
    const verified = verifiedByHash.get(manifestHash);
    return verified ? [{ bundle, checkpoint: verified.checkpoint }] : [];
  });
}

/**
 * Lets a later projection read cite these bundles instead of downloading
 * them again. Best effort and bounded: the projection already verified, and
 * a cache write must never refuse or stall it. The write is the verifier's
 * last await, so afterwards it rechecks the composite guard checkpoint
 * finalization used — the caller's generation and every lease (such as a
 * policy-history lease) observed on `checkpointContext` — so a verification
 * never succeeds past either.
 */
export async function retainVerifiedProjectionBundles(
  execSql: ExecSql,
  entries: readonly VerifiedManifestBundle[],
  checkpointContext: ProjectionCheckpointContext,
  stillCurrent: (() => boolean) | undefined,
): Promise<void> {
  await boundedRetention(
    // A missed write only means the next read carries these bundles again.
    rememberVerifiedManifestBundles(execSql, entries).catch(() => undefined),
  );
  assertProjectionVerificationCurrent(
    projectionLifetimeGuard(checkpointContext, stillCurrent),
  );
}

/**
 * The cache write never delays a verified projection by more than this; a
 * slower write finishes in the background.
 */
export const BUNDLE_RETENTION_DEADLINE_MS = 250;

function boundedRetention(write: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, BUNDLE_RETENTION_DEADLINE_MS);
    void write.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
