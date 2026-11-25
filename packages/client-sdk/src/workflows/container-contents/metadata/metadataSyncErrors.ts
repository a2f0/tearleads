import { isDocumentSyncUpdateIsolationError } from "../../../data/documents/shared/sync/documentSyncUpdateIsolation";
import { isPrincipalPolicyNotCachedError } from "../../../data/keyingProjectionVerification";
import {
  isKeyingVerificationError,
  reportKeyingVerificationErrorInCauseChain,
  type SecurityIncidentReporter,
} from "../../../data/shared/securityIncidents";

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

/**
 * Logs a served page a pass left unimported because it extends the writer
 * peer over operations written here that the pass's copy lacks
 * (`metadataWriterPeerMachine.ts`, `collide`). The pass saved nothing, so the
 * container's needing-sync state stays set, and the pass the local edit
 * schedules judges the page against a copy that holds those operations.
 */
export function logDeferredWriterPeerPage(
  runtime: { util: { log: (message: string) => void } },
  containerId: string,
): void {
  runtime.util.log(
    `Container contents: deferred a metadata page for ${containerId} because it extends this device's writer peer over a local edit the pass did not hold.`,
  );
}
