import { isContainerNotFoundFailure } from "../../data/containers/shared/mutationFailures";
import type { DocumentLinkSetFailureHandler } from "../documents";
import {
  createDocumentMoveFailureState,
  type DocumentMoveFailureState,
  recordDocumentMoveFailure,
} from "./documentMoveFailure";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

export interface VanishedContainerRefreshOutcome<TMoved> {
  readonly failure: DocumentMoveFailureState;
  readonly moved: TMoved;
  /**
   * Park the intent terminally: the destination itself is gone (coded 404 on
   * its refreshed projection) or the refreshed retry vanished again.
   */
  readonly unavailable: boolean;
}

/**
 * A vanished-container verdict (coded container 404 or `container_unavailable`
 * 409) does not by itself doom a queued move. The deleted container may be a
 * stale ANCESTOR in the cached destination path — the destination was moved
 * under a live parent before its former parent was deleted — and the local
 * tombstone cascade cannot rescue that intent (it retargets only intents whose
 * source or destination IS the tombstoned container). So refresh before
 * declaring terminal: evict the cached destination and document projections,
 * probe the destination, and if it still resolves retry once with the fresh
 * paths. The pass is bounded: the retry's own vanished verdict parks the
 * intent instead of looping, and a transient probe failure leaves it
 * retriable (or denied on 403) for a later pass.
 */
export async function moveWithVanishedContainerRefresh<TMoved>(input: {
  apiClient: ContainerContentsWorkflowRuntime["apiClient"];
  attempt: (
    onFailure: DocumentLinkSetFailureHandler,
  ) => Promise<TMoved | "abandoned">;
  documentId: string;
  isCurrent: () => boolean;
  targetContainerId: string;
}): Promise<VanishedContainerRefreshOutcome<TMoved> | "abandoned"> {
  const firstFailure = createDocumentMoveFailureState();
  const first = await input.attempt((failure) =>
    recordDocumentMoveFailure(firstFailure, failure),
  );
  if (first === "abandoned" || !input.isCurrent()) return "abandoned";
  if (!firstFailure.sawVanishedContainer) {
    return { failure: firstFailure, moved: first, unavailable: false };
  }

  input.apiClient.evictContainerWriterProjection(input.targetContainerId);
  input.apiClient.evictDocumentWriterProjection(input.documentId);
  const probe = await input.apiClient.getContainerWriterProjectionResult(
    input.targetContainerId,
    { reportErrors: false },
  );
  if (!input.isCurrent()) return "abandoned";
  if (!probe.ok) {
    probe.report();
    recordDocumentMoveFailure(firstFailure, probe);
    return {
      failure: firstFailure,
      moved: first,
      unavailable: isContainerNotFoundFailure(probe),
    };
  }

  const retryFailure = createDocumentMoveFailureState();
  const retried = await input.attempt((failure) =>
    recordDocumentMoveFailure(retryFailure, failure),
  );
  if (retried === "abandoned" || !input.isCurrent()) return "abandoned";
  return {
    failure: retryFailure,
    moved: retried,
    unavailable: retryFailure.sawVanishedContainer,
  };
}
