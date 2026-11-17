import { KeyingVerificationError } from "@tearleads/crypto";
import {
  heldBundlesUsedBy,
  rejectDecodedProjection,
} from "@tearleads/validators/response";
import { dropHeldManifestBundles } from "../../persistence/verifiedManifestBundlePersistence";
import type { ExecSql } from "../../sqlite/sqlSchema";

/**
 * Runs a projection verification whose projection may have taken bundles
 * from this device's citation store. A store row is never verifier trust
 * input, but a wrong one (such as a seeded authored bundle) would otherwise
 * fail every read that cites it. When such a projection fails to verify, the
 * cited rows are dropped (only those still holding the exact bytes cited, and
 * only while the request is current) and the projection is marked refused so
 * no cache serves it again: the next read fetches those bundles from the
 * server and its verification decides. The refusal itself is reported
 * unchanged, so a failure in freshly served evidence keeps its meaning.
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
    if (held.length > 0 && error instanceof KeyingVerificationError) {
      rejectDecodedProjection(input.projection);
      await dropHeldManifestBundles(
        input.execSql,
        held,
        input.stillCurrent,
      ).catch(() => undefined);
    }
    throw error;
  }
}
