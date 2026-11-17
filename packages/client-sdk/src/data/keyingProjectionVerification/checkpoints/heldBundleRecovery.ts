import {
  type KeyingVerificationCode,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { heldBundlesUsedBy } from "@tearleads/validators/response";
import { dropHeldManifestBundles } from "../../persistence/verifiedManifestBundlePersistence";
import { ProjectionDependencyUnavailableError } from "../../shared/dependencyUnavailable";
import type { ExecSql } from "../../sqlite/sqlSchema";

// Freshness refusals keep their meaning: they say the served history is
// older than this device has seen, not that a held bundle is wrong.
const FRESHNESS_CODES: ReadonlySet<KeyingVerificationCode> = new Set([
  "rollback",
  "stale_predecessor",
]);

/**
 * Runs a projection verification whose projection may have taken bundles
 * from this device's citation store. A store row is never verifier trust
 * input, but a wrong one (such as a seeded authored bundle) would otherwise
 * fail every read that cites it: when such a projection fails to verify, the
 * cited rows are dropped (only those still holding the exact bytes cited, and
 * only while the request is current) and the failure is reported as
 * unavailable, so the next read fetches those bundles from the server and its
 * verification decides. A projection that cited nothing, or a freshness
 * refusal, fails as before.
 */
export async function verifyWithHeldBundleRecovery<T>(
  input: {
    readonly execSql: ExecSql;
    readonly projection: object;
    readonly stillCurrent?: (() => boolean) | undefined;
  },
  verify: () => Promise<T>,
): Promise<T> {
  try {
    return await verify();
  } catch (error) {
    const held = heldBundlesUsedBy(input.projection);
    if (
      held.length === 0 ||
      !(error instanceof KeyingVerificationError) ||
      FRESHNESS_CODES.has(error.code)
    )
      throw error;
    await dropHeldManifestBundles(input.execSql, held, input.stillCurrent);
    throw new ProjectionDependencyUnavailableError(
      `A projection citing held bundles failed verification (${error.message}); the next read fetches them again`,
    );
  }
}
