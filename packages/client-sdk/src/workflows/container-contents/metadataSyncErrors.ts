import { isKeyingVerificationError } from "../../data/keyingProjectionVerification/error";
import { isPrincipalPolicyNotCachedError } from "../../data/keyingProjectionVerification/principalPolicyVerification";

function isStaleContainerMetadataSecurityStateError(error: unknown): boolean {
  // Signed-state verification failures are terminal integrity incidents, even
  // when their diagnostic message resembles an ordinary stale-key condition.
  if (isKeyingVerificationError(error)) return false;
  const message = error instanceof Error ? error.message : "";

  return (
    message.startsWith(
      "Document authorizing container KEK path could not be unwrapped",
    ) ||
    message.startsWith("Document content key could not be unwrapped") ||
    message.startsWith("Document content-key bundle is stale") ||
    message.startsWith("Document content-key re-wrap KEK is unavailable") ||
    message.startsWith("Document stale-bundle recovery") ||
    message === "Document sync target hash mismatch" ||
    message === "Document sync content-key targets mismatch"
  );
}

export function deferRecoverableMetadataSyncError(input: {
  containerId: string;
  error: unknown;
  runtime: { util: { log: (message: string) => void } };
}): null {
  if (isStaleContainerMetadataSecurityStateError(input.error)) {
    input.runtime.util.log(
      `Container contents: deferred metadata sync for ${input.containerId} because its content-key targets are stale.`,
    );
    return null;
  }

  // A cold principal-policy cache is transient: warming already ran and failed
  // within this attempt. Keep the needing-sync state set for the next trigger.
  if (isPrincipalPolicyNotCachedError(input.error)) {
    input.runtime.util.log(
      `Container contents: deferred metadata sync for ${input.containerId} because a referenced principal policy is not cached yet.`,
    );
    return null;
  }

  throw input.error;
}
