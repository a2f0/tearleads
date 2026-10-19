import type { AppliedContainerMove } from "../../../containers";
import type { ContainerState, RemoteContainer } from "../../remoteHydration";
import type { ContainerMoveIntentSyncInput } from "../types";

type AcceptedMoveInput = Pick<
  ContainerMoveIntentSyncInput,
  "intent" | "isCurrent" | "requestRetry" | "state"
>;

/**
 * The server holds a move this pass did not settle. Keep the intent queued,
 * report it with a fixed message (the error's call site names the path), and
 * ask for a later pass: its replay finds the move applied and settles it
 * without posting again, so no reload or unrelated write is needed.
 */
export function leaveAcceptedMoveQueued(
  syncInput: AcceptedMoveInput,
  message: string,
  error: Error,
): void {
  try {
    const report = syncInput.state.runtime.util.logError;
    if (report) void Promise.resolve(report(message, error)).catch(() => {});
  } catch {
    // A host logger must not change the replay result.
  }
  syncInput.requestRetry(syncInput.intent.id);
}

export const STALE_ACCEPTED_MOVE =
  "Container contents: a stale sync pass dropped an accepted container move";

/** persistAcceptedMoveIntent already asked to reconcile a stale result. */
export function unpersistedAcceptedMove(
  syncInput: AcceptedMoveInput,
): "abandoned" | "failed" {
  if (!syncInput.isCurrent()) {
    leaveAcceptedMoveQueued(
      syncInput,
      STALE_ACCEPTED_MOVE,
      new Error("Stale pass dropped a persisting container move"),
    );
    return "abandoned";
  }
  leaveAcceptedMoveQueued(
    syncInput,
    "Container contents: an accepted container move did not persist",
    new Error("Accepted container move did not persist"),
  );
  return "failed";
}

/** The server accepted, but this current pass got no result to settle. */
export function unacknowledgedAcceptedMove(
  syncInput: AcceptedMoveInput,
): "failed" {
  leaveAcceptedMoveQueued(
    syncInput,
    "Container contents: an accepted container move was not acknowledged",
    new Error("Accepted container move was not acknowledged"),
  );
  return "failed";
}

/**
 * Settles from the verified head the server already holds. A head carries no
 * server timestamps, so the container keeps the ones this device holds.
 */
export function appliedRemoteContainer(
  containerState: ContainerState,
  applied: AppliedContainerMove,
): RemoteContainer {
  const { container } = containerState;
  const createdAt = container.serverCreatedAt ?? container.createdAt;
  const updatedAt = container.serverUpdatedAt ?? container.updatedAt;
  if (!createdAt || !updatedAt) {
    throw new Error("A synced container must carry its server timestamps");
  }
  const { state } = applied;
  return {
    createdAt,
    effectiveAccessLevel: "admin",
    id: state.containerId,
    metadataAccessEpoch: state.epoch,
    metadataAccessStateHash: applied.manifestHash,
    metadataDocumentId: state.metadataDocumentId,
    // Verifying the head already warmed the policies it references.
    metadataReferencedPrincipals: [],
    organizationId: state.organizationId,
    parentId: state.parentContainerId,
    updatedAt,
  };
}
