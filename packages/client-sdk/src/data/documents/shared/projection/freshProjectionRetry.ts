import { KeyingVerificationError } from "@tearleads/crypto";
import { ProjectionDependencyUnavailableError } from "../../../keyingProjectionVerification/dependencyUnavailable";
import { isKeyingVerificationError } from "../../../keyingProjectionVerification/error";
import { ContainerKekRepairRequiredError } from "../containerKek/containerKekCurrency";

type ProjectionIntegrityErrorCode =
  | "equivocation"
  | "rollback"
  | "stale_predecessor";

function keyingVerificationErrorCode(error: unknown): string | null {
  if (!isKeyingVerificationError(error) || !(error instanceof Error)) {
    return null;
  }
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

export function projectionIntegrityErrorCode(
  error: unknown,
): ProjectionIntegrityErrorCode | null {
  if (
    !(error instanceof KeyingVerificationError) &&
    !(error instanceof Error && error.name === "KeyingVerificationError")
  ) {
    return null;
  }

  const code = keyingVerificationErrorCode(error);
  return code === "rollback" ||
    code === "equivocation" ||
    code === "stale_predecessor"
    ? code
    : null;
}

/**
 * Shared shell for the stale-projection retry classifiers. A cached
 * projection older than a checkpoint we already recorded ("rollback") —
 * typical right after a peer shared/rotated a linked container — is resolved
 * by refetching the current projection. The refetch is safe: it cannot
 * bypass the anti-rollback check, because a genuinely rolled-back server
 * response re-throws on the rebuilt plan. Any other keying-verification
 * failure is terminal; anything else defers to the caller's message
 * predicate for its unwrap-failure shape.
 */
export function shouldRetryWithFreshProjection(
  error: unknown,
  messageMatches: (message: string) => boolean,
): boolean {
  // A peer may already have repaired the chain. Refetch once; the same guard
  // rejects a still-stale response before any new ciphertext is produced.
  if (
    error instanceof ContainerKekRepairRequiredError ||
    error instanceof ProjectionDependencyUnavailableError
  )
    return true;
  const integrityErrorCode = projectionIntegrityErrorCode(error);
  if (integrityErrorCode) {
    return integrityErrorCode === "rollback";
  }
  if (keyingVerificationErrorCode(error) === "invalid_shape") {
    // Verification boundaries normalize malformed/stale projection data to a
    // terminal error. One cache eviction is still safe: a dishonest or broken
    // fresh response fails again outside this retry boundary.
    return true;
  }
  if (isKeyingVerificationError(error)) {
    return false;
  }

  return error instanceof Error && messageMatches(error.message);
}
