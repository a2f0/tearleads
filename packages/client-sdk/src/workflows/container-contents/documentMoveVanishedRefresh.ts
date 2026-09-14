import { isContainerNotFoundFailure } from "../../data/containers/shared/mutationFailures";
import { readLinkedContainerIdsFromDocumentManifest } from "../../data/documents/shared/projection";
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
   * Park the intent terminally. True only when the destination itself is
   * proven gone: a coded 404 on its projection probe after eviction. No
   * mutation verdict — first attempt or retry — is ever terminal.
   */
  readonly unavailable: boolean;
}

/**
 * Every container the unlink half of the move can cite. The unlink set is
 * read off the REMOTE document manifest's link set, so that set — refetched
 * after eviction so it is current — is the authority; the local link
 * projection, the intent's source, and the document's local placement are
 * unioned in so a source known only on one side still gets its cached path
 * refreshed. A superset is harmless: an eviction only forces a refetch, and
 * nothing here decides what gets unlinked.
 */
async function listMoveSourceContainerIds(input: {
  apiClient: ContainerContentsWorkflowRuntime["apiClient"];
  execSql: ExecSql;
  existingContainerId: string | null | undefined;
  intent: DocumentMoveIntentRecord;
}): Promise<string[]> {
  const { documentId, targetContainerId } = input.intent;
  const [remote, local] = await Promise.all([
    input.apiClient.getDocumentWriterProjectionResult(documentId, {
      reportErrors: false,
    }),
    listDocumentLinkedContainerIds(input.execSql, documentId),
  ]);
  const remoteLinkedContainerIds = remote.ok
    ? readLinkedContainerIdsFromDocumentManifest(remote.data)
    : [];
  return Array.from(
    new Set([
      ...remoteLinkedContainerIds,
      ...local,
      input.intent.sourceContainerId,
      input.existingContainerId,
    ]),
  )
    .filter(
      (containerId): containerId is string =>
        typeof containerId === "string" && containerId !== targetContainerId,
    )
    .sort();
}

/**
 * A vanished-container verdict (coded container 404 or `container_unavailable`
 * 409) does not by itself doom a queued move. The deleted container may be a
 * stale ANCESTOR in a cached path — the destination or a source was moved
 * under a live parent before its former parent was deleted — and the local
 * tombstone cascade cannot rescue that intent (it retargets only intents whose
 * source or destination IS the tombstoned container). So refresh before
 * declaring terminal: evict the cached destination, document, and source
 * projections, probe the destination, and retry once with the fresh paths.
 *
 * Only the destination's fate is terminal, and only as proven by its own
 * probe. Sources are evicted, never judged: the retry's unlink set comes from
 * the verified manifest alone, so a server-asserted "source gone" can neither
 * skip a revoke nor complete the move — a retry whose link landed but whose
 * unlink still vanished stays partial (pending) with a live link the queue
 * keeps trying to revoke. The retry's own vanished verdict, on either side, is
 * likewise never terminal: with the destination live it can only name another
 * ancestor deleted mid-pass, which the next pass's fresh paths outrun. The
 * pass is bounded to one retry; a transient probe failure leaves the intent
 * retriable (or denied on 403) for a later pass.
 */
export async function moveWithVanishedContainerRefresh<TMoved>(input: {
  apiClient: ContainerContentsWorkflowRuntime["apiClient"];
  attempt: (
    onFailure: DocumentLinkSetFailureHandler,
  ) => Promise<TMoved | "abandoned">;
  execSql: ExecSql;
  existingContainerId: string | null | undefined;
  intent: DocumentMoveIntentRecord;
  isCurrent: () => boolean;
}): Promise<VanishedContainerRefreshOutcome<TMoved> | "abandoned"> {
  const { apiClient, intent } = input;
  const firstFailure = createDocumentMoveFailureState();
  const first = await input.attempt((failure) =>
    recordDocumentMoveFailure(firstFailure, failure),
  );
  if (first === "abandoned" || !input.isCurrent()) return "abandoned";
  if (!firstFailure.sawVanishedContainer) {
    return { failure: firstFailure, moved: first, unavailable: false };
  }

  apiClient.evictContainerWriterProjection(intent.targetContainerId);
  const destination = await apiClient.getContainerWriterProjectionResult(
    intent.targetContainerId,
    { reportErrors: false },
  );
  apiClient.evictDocumentWriterProjection(intent.documentId);
  if (!input.isCurrent()) return "abandoned";
  if (!destination.ok) {
    destination.report();
    recordDocumentMoveFailure(firstFailure, destination);
    return {
      failure: firstFailure,
      moved: first,
      unavailable: isContainerNotFoundFailure(destination),
    };
  }

  for (const sourceContainerId of await listMoveSourceContainerIds(input)) {
    apiClient.evictContainerWriterProjection(sourceContainerId);
  }
  if (!input.isCurrent()) return "abandoned";

  const retryFailure = createDocumentMoveFailureState();
  const retried = await input.attempt((failure) =>
    recordDocumentMoveFailure(retryFailure, failure),
  );
  if (retried === "abandoned" || !input.isCurrent()) return "abandoned";
  // The retry's own vanished verdict is never terminal. The destination was
  // just proven live, so a second `container_unavailable` can only name
  // another ancestor deleted during the refreshed attempt (or a source): the
  // intent stays pending with its failure recorded and the next pass starts
  // over with freshly evicted projections. One retry per pass keeps it
  // bounded; nothing in the queue backs a pending intent off between passes.
  return { failure: retryFailure, moved: retried, unavailable: false };
}
