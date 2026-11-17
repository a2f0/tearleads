import {
  type KeyingVerificationCode,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { heldBundlesUsedBy } from "@tearleads/validators/response";
import { dropVerifiedManifestBundles } from "../../persistence/verifiedManifestBundlePersistence";
import { ProjectionDependencyUnavailableError } from "../../shared/dependencyUnavailable";
import type { ExecSql } from "../../sqlite/sqlSchema";

// Refusals of a bundle's own bytes, which a wrong stored row can cause.
// Freshness refusals (rollback, a stale predecessor) keep their meaning.
const BUNDLE_CONTENT_CODES: ReadonlySet<KeyingVerificationCode> = new Set([
  "hash_mismatch",
  "invalid_domain",
  "invalid_shape",
  "object_mismatch",
  "signature_mismatch",
  "signer_mismatch",
]);

/**
 * Runs a projection verification whose projection may have taken bundles
 * from this device's citation store. A store row is never verifier trust
 * input, but a wrong one (such as a seeded authored bundle) would otherwise
 * fail every read that cites it: when such a projection fails to verify, the
 * cited rows are dropped and the failure is reported as unavailable, so the
 * next read fetches those bundles from the server and its verification
 * decides. A projection that cited nothing fails as before.
 */
export async function verifyWithHeldBundleRecovery<T>(
  execSql: ExecSql,
  projection: object,
  verify: () => Promise<T>,
): Promise<T> {
  try {
    return await verify();
  } catch (error) {
    const held = heldBundlesUsedBy(projection);
    if (
      held.length === 0 ||
      !(error instanceof KeyingVerificationError) ||
      !BUNDLE_CONTENT_CODES.has(error.code)
    )
      throw error;
    await dropVerifiedManifestBundles(execSql, held);
    throw new ProjectionDependencyUnavailableError(
      `A projection citing held bundles failed verification (${error.message}); the next read fetches them again`,
    );
  }
}
