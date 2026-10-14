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
 * them again. Best effort: the projection already verified, and a cache
 * write must never turn that into a refusal. The write is the verifier's
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
  try {
    await rememberVerifiedManifestBundles(execSql, entries);
  } catch {
    // A missed write only means the next read carries these bundles again.
  }
  assertProjectionVerificationCurrent(
    projectionLifetimeGuard(checkpointContext, stillCurrent),
  );
}
