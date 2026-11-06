import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  DIRECTORY_IDLE,
  type DocumentSummaryDirectoryEvent,
  transitionDocumentSummaryDirectory,
} from "./documentSummaryDirectoryMachine";

interface SummaryDiscoveryView {
  getSnapshot: () => {
    documentSummariesByContainerId: ReadonlyMap<
      string,
      ReadonlyArray<DocumentSummary>
    >;
  };
  subscribe: (listener: () => void) => () => void;
}

/** Discovery adds shells without a document-store persistence notification. */
function subscribeToDocumentSummaryDiscovery(input: {
  isCurrent: () => boolean;
  onDiscovery: () => void;
  view: SummaryDiscoveryView;
}): () => void {
  const readIds = () =>
    new Set(
      [
        ...input.view.getSnapshot().documentSummariesByContainerId.values(),
      ].flatMap((rows) => rows.map((row) => row.id)),
    );
  let observed = readIds();
  return input.view.subscribe(() => {
    if (!input.isCurrent()) return;
    const current = readIds();
    if (
      current.size === observed.size &&
      [...current].every((id) => observed.has(id))
    )
      return;
    observed = current;
    // Read titles/kinds from SQLite; an older view shell must never replace a
    // newer decrypted persisted summary. Metadata-only churn needs no reload.
    input.onDiscovery();
  });
}

/** Coalesce local reloads and keep an in-flight query behind live writes. */
export function subscribeToDocumentSummaryDirectory(input: {
  isCurrent: () => boolean;
  load: () => Promise<ReadonlyArray<DocumentSummary>>;
  onError: (error: unknown) => void;
  onLoaded: (summaries: ReadonlyArray<DocumentSummary>) => void;
  onPersisted: (summary: DocumentSummary) => void;
  subscribePersisted: (
    listener: (summary: DocumentSummary) => void,
  ) => () => void;
  view: SummaryDiscoveryView;
}): () => void {
  let state = DIRECTORY_IDLE;
  // Bumped by every live write or discovery; a query answers only if none
  // landed since it started.
  let revision = 0;
  const send = (event: DocumentSummaryDirectoryEvent) => {
    state = transitionDocumentSummaryDirectory(state, event);
  };
  const isCurrent = () => state.status !== "disposed" && input.isCurrent();
  const answersRevision = (requestedRevision: number) =>
    isCurrent() && revision === requestedRevision;
  const deliverRows = (
    requestedRevision: number,
    rows: ReadonlyArray<DocumentSummary>,
  ) => {
    if (answersRevision(requestedRevision)) input.onLoaded(rows);
  };
  const deliverError = (requestedRevision: number, error: unknown) => {
    if (answersRevision(requestedRevision)) input.onError(error);
  };
  // Keep the loop inline: an awaited helper would add microtask hops.
  const load = async () => {
    if (!isCurrent()) return;
    const startsLoop = state.status === "idle";
    send({ type: "load-requested" });
    if (!startsLoop) return;
    try {
      do {
        send({ type: "pass-started" });
        const requestedRevision = revision;
        try {
          deliverRows(requestedRevision, await input.load());
        } catch (error) {
          deliverError(requestedRevision, error);
        }
      } while (isCurrent() && state.status === "loading-with-reload");
    } finally {
      send({ type: "loop-finished" });
    }
  };
  const unsubscribePersisted = input.subscribePersisted((summary) => {
    if (!isCurrent()) return;
    revision += 1;
    send({ type: "persisted" });
    input.onPersisted(summary);
  });
  const unsubscribeDiscovery = subscribeToDocumentSummaryDiscovery({
    isCurrent,
    onDiscovery: () => {
      revision += 1;
      void load();
    },
    view: input.view,
  });
  void load();
  return () => {
    send({ type: "disposed" });
    unsubscribeDiscovery();
    unsubscribePersisted();
  };
}
