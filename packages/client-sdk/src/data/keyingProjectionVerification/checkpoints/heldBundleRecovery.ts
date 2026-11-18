import { KeyingVerificationError } from "@tearleads/crypto";
import {
  acceptDecodedProjection,
  heldBundlesUsedBy,
  rejectDecodedProjection,
} from "@tearleads/validators/response";
import {
  dropHeldManifestBundles,
  suppressHeldCitations,
} from "../../persistence/verifiedManifestBundlePersistence";
import { ProjectionDependencyUnavailableError } from "../../shared/dependencyUnavailable";
import type { ExecSql } from "../../sqlite/sqlSchema";

/**
 * Runs a projection verification whose projection may have taken bundles
 * from this device's citation store. A store row is never verifier trust
 * input, but a wrong one (such as a seeded authored bundle) would otherwise
 * fail every read that cites it. When such a projection fails to verify (or
 * a dependency it names, such as its signer, is unavailable), the
 * cited rows are dropped (only those still holding the exact bytes cited, and
 * only while the request is current) and the projection is marked refused so
 * no cache serves it again: the next read fetches those bundles from the
 * server and its verification decides. The refusal itself is reported
 * unchanged, so a failure in freshly served evidence keeps its meaning.
 */
interface HeldBundleRecoveryInput {
  readonly execSql: ExecSql;
  readonly projection: object;
  readonly stillCurrent?: (() => boolean) | undefined;
}

export function verifyWithHeldBundleRecovery<T>(
  input: HeldBundleRecoveryInput,
  verify: () => Promise<T>,
): Promise<T> {
  return runWithHeldBundleRecovery(
    input,
    verify,
    (error) =>
      error instanceof KeyingVerificationError ||
      error instanceof ProjectionDependencyUnavailableError,
    true,
  );
}

/**
 * The same recovery for a check of a projection's own consistency that runs
 * before verification (such as a document head's hashes before a queued
 * write): any refusal of a projection that took held bundles drops them.
 */
export function checkWithHeldBundleRecovery<T>(
  input: HeldBundleRecoveryInput,
  check: () => Promise<T>,
): Promise<T> {
  return runWithHeldBundleRecovery(input, check, () => true, false);
}

async function runWithHeldBundleRecovery<T>(
  input: HeldBundleRecoveryInput,
  run: () => Promise<T>,
  recovers: (error: unknown) => boolean,
  verifies: boolean,
): Promise<T> {
  try {
    const result = await run();
    // Only a full, current verification vouches for every held byte it used;
    // a consistency check covers one bundle and accepts nothing.
    if (verifies && input.stillCurrent?.() !== false)
      acceptDecodedProjection(input.projection);
    return result;
  } catch (error) {
    const held = heldBundlesUsedBy(input.projection);
    // A superseded request changes no shared cache state.
    if (
      held.length > 0 &&
      input.stillCurrent?.() !== false &&
      recovers(error)
    ) {
      // No read cites these rows while they are dropped, and no cache serves
      // this projection again, so the next read fetches the bundles.
      const release = suppressHeldCitations(
        held.map((bundle) => bundle.manifestHash),
      );
      rejectDecodedProjection(input.projection);
      // Released only once the rows are gone: a failed drop keeps them out of
      // this process's citations rather than citing the same bytes again.
      await dropHeldManifestBundles(input.execSql, held, input.stillCurrent)
        .then(release)
        .catch(() => undefined);
    }
    throw error;
  }
}
