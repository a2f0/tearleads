import {
  type ContainerDocumentQueries,
  type DomainScope,
  discardRegisteredDocumentLocalState,
  type PendingWriteQueueItem,
  requestAllDomainSyncLanes,
  requestContainerContentsDocumentPriming,
} from "@tearleads/client-sdk";
import { useCurrentWindow } from "@tearleads/windowing";
import { useCallback } from "react";
import { EXPLORER_LABELS } from "../../labels";

/** What a queued entry's row menu runs once the user picks it. */
export interface WriteQueueActions {
  discardPendingWrites: (item: PendingWriteQueueItem) => void;
  retryPendingWrites: (item: PendingWriteQueueItem) => void;
}

export function useWriteQueueActions(
  documentQueries: ContainerDocumentQueries,
  domainScope: DomainScope,
): WriteQueueActions {
  // Per-entry "Retry sync": reset the item's parked retry state (recorded
  // terminal failure, and for documents the durable re-key budget — a cap
  // burned during an outage should not be terminal forever), then arm every
  // pump-driven lane. Clean stores skip cheaply, blocked/errored intents
  // replay, and offline requests stay queued until prerequisites return.
  const retryPendingWrites = useCallback(
    (item: PendingWriteQueueItem) => {
      void documentQueries
        .retryPendingWriteItem({
          localId: item.localId,
          namespace: item.namespace,
          objectKind: item.objectKind,
        })
        .catch(() => undefined)
        .finally(() => {
          requestAllDomainSyncLanes(domainScope);
          // A failure-only revalidation item has no queued work for any lane
          // to pick up; priming (which selects documents with a recorded
          // sync failure) is what actually re-opens the store and retries
          // the refused revalidation.
          if (item.objectKind === "document") {
            requestContainerContentsDocumentPriming(domainScope);
          }
        });
    },
    [documentQueries, domainScope],
  );
  // Per-entry "Discard local edits": tear down the document's local state
  // through its registered store (so an in-flight persist cannot resurrect
  // the deleted rows), then re-arm document priming so the server copy is
  // re-created without an app restart. Retry keeps the queued writes; this is
  // the escape hatch for a queue that can never sync (e.g. permanently
  // conflicting update ids), trading local-only edits for server truth. A
  // refusal (the document moved, relinked, or changed under the dialog) is
  // surfaced — a confirmed destructive action must never silently no-op.
  const currentWindow = useCurrentWindow();
  const discardPendingWrites = useCallback(
    (item: PendingWriteQueueItem) => {
      if (item.remoteId === null) {
        return;
      }
      void discardRegisteredDocumentLocalState(
        domainScope,
        item.localId,
        item.remoteId,
      )
        // A refusal (false) and an operational failure (throw) read
        // differently to the user: the first means the document's state made
        // the discard unsafe, the second that nothing changed and retrying
        // is reasonable.
        .then(
          (discarded): "discarded" | "refused" =>
            discarded ? "discarded" : "refused",
          (): "failed" => "failed",
        )
        .then((outcome) => {
          if (outcome === "discarded") {
            requestContainerContentsDocumentPriming(domainScope);
            return;
          }
          currentWindow?.showStatusMessage(
            outcome === "refused"
              ? EXPLORER_LABELS.writeQueueDiscardRefusedStatus
              : EXPLORER_LABELS.writeQueueDiscardFailedStatus,
          );
        })
        .finally(() => {
          requestAllDomainSyncLanes(domainScope);
        });
    },
    [currentWindow, domainScope],
  );
  return { discardPendingWrites, retryPendingWrites };
}
