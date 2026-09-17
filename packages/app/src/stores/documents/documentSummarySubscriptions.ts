import type { DocumentSummary } from "@tearleads/client-sdk";

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
  let active = true;
  let loading = false;
  let reloadRequested = false;
  let revision = 0;
  const isCurrent = () => active && input.isCurrent();
  const load = async () => {
    if (!isCurrent()) return;
    if (loading) {
      reloadRequested = true;
      return;
    }
    loading = true;
    try {
      do {
        reloadRequested = false;
        const requestedRevision = revision;
        try {
          const rows = await input.load();
          if (isCurrent() && revision === requestedRevision)
            input.onLoaded(rows);
        } catch (error) {
          if (isCurrent() && revision === requestedRevision)
            input.onError(error);
        }
      } while (isCurrent() && reloadRequested);
    } finally {
      loading = false;
    }
  };
  const unsubscribePersisted = input.subscribePersisted((summary) => {
    if (!isCurrent()) return;
    revision += 1;
    if (loading) reloadRequested = true;
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
    active = false;
    unsubscribeDiscovery();
    unsubscribePersisted();
  };
}
