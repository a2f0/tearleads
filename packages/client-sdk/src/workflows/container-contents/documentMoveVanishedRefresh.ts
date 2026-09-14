import { isContainerNotFoundFailure } from "../../data/containers/shared/mutationFailures";
import type { DocumentMoveIntentRecord } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { DocumentLinkSetFailureHandler } from "../documents";
import { listDocumentLinkedContainerIds } from "./documentLinks";
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

export interface VanishedContainerRetryOptions {
  /** Sources proven deleted by their refreshed probe: their unlink is moot. */
  readonly excludeUnlinkContainerIds: readonly string[];
}

type ContainerProjectionProbe = Awaited<
  ReturnType<
    ContainerContentsWorkflowRuntime["apiClient"]["getContainerWriterProjectionResult"]
  >
>;

async function probeRefreshedContainer(input: {
  apiClient: ContainerContentsWorkflowRuntime["apiClient"];
  containerId: string;
  failure: DocumentMoveFailureState;
}): Promise<ContainerProjectionProbe> {
  input.apiClient.evictContainerWriterProjection(input.containerId);
  const probe = await input.apiClient.getContainerWriterProjectionResult(
    input.containerId,
    { reportErrors: false },
  );
  if (!probe.ok) {
    probe.report();
    recordDocumentMoveFailure(input.failure, probe);
  }
  return probe;
}

/**
 * Every container the unlink half of the move can cite: the intent's source,
 * the document's current local placement, and every locally projected link —
 * minus the destination. A superset is harmless (an eviction only forces a
 * refetch), while a miss would leave a stale source path in the retry.
 */
async function listMoveSourceContainerIds(input: {
  execSql: ExecSql;
  existingContainerId: string | null | undefined;
  intent: DocumentMoveIntentRecord;
}): Promise<string[]> {
  const linkedContainerIds = await listDocumentLinkedContainerIds(
    input.execSql,
    input.intent.documentId,
  );
  return Array.from(
    new Set([
      ...linkedContainerIds,
      input.intent.sourceContainerId,
      input.existingContainerId,
    ]),
  ).filter(
    (containerId): containerId is string =>
      typeof containerId === "string" &&
      containerId !== input.intent.targetContainerId,
  );
}

/**
 * A vanished-container verdict (coded container 404 or `container_unavailable`
 * 409) does not by itself doom a queued move. The deleted container may be a
 * stale ANCESTOR in a cached path — the destination or a source was moved
 * under a live parent before its former parent was deleted — and the local
 * tombstone cascade cannot rescue that intent (it retargets only intents whose
 * source or destination IS the tombstoned container). So refresh before
 * declaring terminal: evict the cached destination, document, and source
 * projections, probe each container, and retry once with the fresh paths.
 *
 * Only the destination's fate is terminal: a coded 404 on its refreshed probe
 * parks the intent. A source proven gone the same way merely drops out of the
 * retry's unlink set — its link died with the container, so unlinking it is
 * moot. The pass is bounded: the retry's own vanished verdict parks the intent
 * instead of looping, and a transient probe failure leaves it retriable (or
 * denied on 403) for a later pass.
 */
export async function moveWithVanishedContainerRefresh<TMoved>(input: {
  apiClient: ContainerContentsWorkflowRuntime["apiClient"];
  attempt: (
    onFailure: DocumentLinkSetFailureHandler,
    options: VanishedContainerRetryOptions,
  ) => Promise<TMoved | "abandoned">;
  execSql: ExecSql;
  existingContainerId: string | null | undefined;
  intent: DocumentMoveIntentRecord;
  isCurrent: () => boolean;
}): Promise<VanishedContainerRefreshOutcome<TMoved> | "abandoned"> {
  const { apiClient, intent } = input;
  const firstFailure = createDocumentMoveFailureState();
  const first = await input.attempt(
    (failure) => recordDocumentMoveFailure(firstFailure, failure),
    { excludeUnlinkContainerIds: [] },
  );
  if (first === "abandoned" || !input.isCurrent()) return "abandoned";
  if (!firstFailure.sawVanishedContainer) {
    return { failure: firstFailure, moved: first, unavailable: false };
  }

  const destination = await probeRefreshedContainer({
    apiClient,
    containerId: intent.targetContainerId,
    failure: firstFailure,
  });
  apiClient.evictDocumentWriterProjection(intent.documentId);
  if (!input.isCurrent()) return "abandoned";
  if (!destination.ok) {
    return {
      failure: firstFailure,
      moved: first,
      unavailable: isContainerNotFoundFailure(destination),
    };
  }

  const goneSourceIds: string[] = [];
  for (const sourceContainerId of await listMoveSourceContainerIds(input)) {
    const source = await probeRefreshedContainer({
      apiClient,
      containerId: sourceContainerId,
      failure: firstFailure,
    });
    if (!input.isCurrent()) return "abandoned";
    if (!source.ok && isContainerNotFoundFailure(source)) {
      goneSourceIds.push(sourceContainerId);
    }
  }

  const retryFailure = createDocumentMoveFailureState();
  const retried = await input.attempt(
    (failure) => recordDocumentMoveFailure(retryFailure, failure),
    { excludeUnlinkContainerIds: goneSourceIds },
  );
  if (retried === "abandoned" || !input.isCurrent()) return "abandoned";
  return {
    failure: retryFailure,
    moved: retried,
    unavailable: retryFailure.sawVanishedContainer,
  };
}
