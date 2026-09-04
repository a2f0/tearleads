import { isDocumentSyncUpdateIsolationError } from "../../data/documents/shared/documentSyncUpdateIsolation";
import {
  isKeyingVerificationError,
  isStaleCitationError,
  reportKeyingVerificationErrorInCauseChain,
} from "../../data/keyingProjectionVerification/error";
import { isPrincipalPolicyNotCachedError } from "../../data/keyingProjectionVerification/principalPolicyVerification";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";

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

export async function deferRecoverableMetadataSyncError(input: {
  containerId: string;
  error: unknown;
  runtime: {
    auth: { organizationId: string | null };
    util: {
      log: (message: string) => void;
      reportSecurityIncident: SecurityIncidentReporter;
    };
  };
}): Promise<null> {
  if (isDocumentSyncUpdateIsolationError(input.error)) {
    await reportKeyingVerificationErrorInCauseChain(
      input.error,
      input.runtime.util.reportSecurityIncident,
      {
        objectId: input.containerId,
        objectKind: "container",
        operation: "container.metadata.sync",
        organizationId: input.runtime.auth.organizationId,
      },
    );
    input.runtime.util.log(
      `Container contents: quarantined incoming metadata updates for ${input.containerId}; deferred this container without blocking later metadata syncs.`,
    );
    return null;
  }

  // A served head newer than this device's checkpoint that cites a stale
  // ancestor head cannot be told from a stale delivery until a later event on
  // the container cites the current heads. Keep needing-sync set for then.
  if (isStaleCitationError(input.error)) {
    input.runtime.util.log(
      `Container contents: deferred metadata sync for ${input.containerId} because its head cites a stale ancestor head; a later event on the container that cites the current heads supersedes it.`,
    );
    return null;
  }

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
