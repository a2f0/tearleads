import type {
  ContainerDocumentQueries,
  DocumentSummary,
} from "@symcrypt/client-sdk";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { RuntimeSnapshot } from "../../providers/sdk/SymCryptProvider";
import { useSymCrypt } from "../../providers/sdk/SymCryptProvider";
import {
  applyTrackedDocumentSummaryUpdates,
  mergeDocumentSummaryLists,
  mergeSingleDocumentSummaryList,
} from "./documentSummaryUtils";
import { isExplorerOrphanedDocumentsId } from "./orphanedDocuments";

// Subscription deltas for the active container arrive once per persisted write —
// i.e. once per keystroke while a note is being edited, each re-deriving the
// note's short title. Coalesce a burst of them into a single list-revision bump
// (and one merge) on a trailing timer so the sidebar/item-table windows re-query
// SQLite at most a few times a second instead of on every keystroke.
const TRACKED_SUMMARY_FLUSH_MS = 200;

export type ExplorerRouteDocumentSummaryResult =
  | { status: "deferred" }
  | { status: "pending" }
  | { status: "rejected" }
  | { documentSummary: DocumentSummary; status: "loaded" };

// Owns the debounced document subscription: it buffers incoming deltas and, on a
// trailing timer, applies them as one revision bump + merge. Kept apart so the
// per-keystroke coalescing logic doesn't bloat the main state hook.
function useTrackedDocumentSummarySubscription(params: {
  containerId: RuntimeSnapshot["state"]["containerId"];
  domainScope: RuntimeSnapshot["state"]["domainScope"];
  setDocumentListRevision: Dispatch<SetStateAction<number>>;
  setDocumentSummaries: Dispatch<
    SetStateAction<ReadonlyArray<DocumentSummary>>
  >;
  symcrypt: ReturnType<typeof useSymCrypt>;
}) {
  const {
    containerId,
    domainScope,
    setDocumentListRevision,
    setDocumentSummaries,
    symcrypt,
  } = params;
  const pendingTrackedSummariesRef = useRef(new Map<string, DocumentSummary>());
  const flushTrackedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Apply the coalesced deltas: one revision bump for the whole burst, then
  // merge each pending summary that is still listed (the immediate tracked path
  // ignored deltas for untracked ids; preserve that here).
  const flushTrackedDocumentSummaries = useCallback(() => {
    flushTrackedTimerRef.current = null;
    const pending = pendingTrackedSummariesRef.current;
    if (pending.size === 0) {
      return;
    }

    const updates = Array.from(pending.values());
    pending.clear();
    setDocumentListRevision((revision) => revision + 1);
    setDocumentSummaries((currentDocumentSummaries) =>
      applyTrackedDocumentSummaryUpdates(currentDocumentSummaries, updates),
    );
  }, [setDocumentListRevision, setDocumentSummaries]);

  const mergeTrackedDocumentSummary = useCallback(
    (nextDocument: DocumentSummary) => {
      pendingTrackedSummariesRef.current.set(nextDocument.id, nextDocument);
      if (flushTrackedTimerRef.current === null) {
        flushTrackedTimerRef.current = setTimeout(
          flushTrackedDocumentSummaries,
          TRACKED_SUMMARY_FLUSH_MS,
        );
      }
    },
    [flushTrackedDocumentSummaries],
  );

  useEffect(() => {
    const unsubscribe = symcrypt.documents.subscribe(
      mergeTrackedDocumentSummary,
      { containerId },
    );
    return () => {
      unsubscribe();
      // Drop any buffered deltas for the container/scope we're leaving; the new
      // scope reloads its summaries fresh via the reset effects above.
      if (flushTrackedTimerRef.current !== null) {
        clearTimeout(flushTrackedTimerRef.current);
        flushTrackedTimerRef.current = null;
      }
      pendingTrackedSummariesRef.current.clear();
    };
  }, [containerId, domainScope, mergeTrackedDocumentSummary, symcrypt]);
}

function useExplorerDocumentSummaryLoaders(params: {
  currentOrganizationId: string | null;
  dbStatus: RuntimeSnapshot["infra"]["dbStatus"];
  documentQueries: ContainerDocumentQueries;
  mergeDocumentSummary: (summary: DocumentSummary) => void;
}) {
  const {
    currentOrganizationId,
    dbStatus,
    documentQueries,
    mergeDocumentSummary,
  } = params;
  const loadDocumentSummary = useCallback(
    async (localId: string): Promise<DocumentSummary | null> => {
      if (dbStatus !== "ready") {
        return null;
      }

      const documentSummary =
        await documentQueries.loadDocumentSummary(localId);
      if (documentSummary) {
        mergeDocumentSummary(documentSummary);
      }

      return documentSummary;
    },
    [dbStatus, documentQueries, mergeDocumentSummary],
  );
  const loadOrphanedDocumentSummary = useCallback(
    async (localId: string): Promise<DocumentSummary | null> => {
      if (dbStatus !== "ready") {
        return null;
      }

      const documentSummary = await documentQueries.loadOrphanedDocumentSummary(
        { currentOrganizationId, localId },
      );
      if (documentSummary) {
        mergeDocumentSummary(documentSummary);
      }

      return documentSummary;
    },
    [currentOrganizationId, dbStatus, documentQueries, mergeDocumentSummary],
  );
  const loadRouteDocumentSummary = useCallback(
    async (
      localId: string,
      routeContainerId: string,
    ): Promise<ExplorerRouteDocumentSummaryResult> => {
      if (dbStatus !== "ready") {
        return { status: "deferred" };
      }

      if (!isExplorerOrphanedDocumentsId(routeContainerId)) {
        const documentSummary =
          await documentQueries.loadDocumentSummary(localId);
        // A null-container document is only selectable through the scoped
        // recovery collection. Do not let a forged ordinary-container route
        // bypass its organization and surviving-link predicate.
        if (!documentSummary) {
          return { status: "pending" };
        }
        if (documentSummary.containerId === null) {
          return { status: "rejected" };
        }

        mergeDocumentSummary(documentSummary);
        return { documentSummary, status: "loaded" };
      }

      const documentSummary = await loadOrphanedDocumentSummary(localId);
      if (!documentSummary) {
        // Distinguish a valid deep link whose local projection has not arrived
        // yet from a present row rejected by organization/link scoping. The
        // former must remain an optimistic pending selection so discovery can
        // resolve it without another route change.
        const unscopedDocumentSummary =
          await documentQueries.loadDocumentSummary(localId);
        return {
          status: unscopedDocumentSummary ? "rejected" : "pending",
        };
      }

      return { documentSummary, status: "loaded" };
    },
    [
      dbStatus,
      documentQueries,
      loadOrphanedDocumentSummary,
      mergeDocumentSummary,
    ],
  );

  return {
    loadDocumentSummary,
    loadOrphanedDocumentSummary,
    loadRouteDocumentSummary,
  };
}

export function useExplorerDocumentSummaryState(
  dbStatus: RuntimeSnapshot["infra"]["dbStatus"],
  domainScope: RuntimeSnapshot["state"]["domainScope"],
  containerId: RuntimeSnapshot["state"]["containerId"],
  currentOrganizationId: string | null,
  documentQueries: ContainerDocumentQueries,
) {
  const symcrypt = useSymCrypt();
  const [documentSummaries, setDocumentSummaries] = useState<
    ReadonlyArray<DocumentSummary>
  >([]);
  const [documentListRevision, setDocumentListRevision] = useState(0);
  const domainScopeRef = useRef(domainScope);

  useEffect(() => {
    if (dbStatus !== "ready") {
      setDocumentSummaries([]);
      setDocumentListRevision((revision) => revision + 1);
    }
  }, [dbStatus]);

  useEffect(() => {
    if (domainScopeRef.current === domainScope) {
      return;
    }

    domainScopeRef.current = domainScope;
    setDocumentSummaries([]);
    setDocumentListRevision((revision) => revision + 1);
  }, [domainScope]);

  // Force the container item listing to re-query SQLite without changing the
  // in-memory summaries (e.g. after a document was deleted out from under the
  // current view). The detail pane keys its reload on documentListRevision.
  const bumpDocumentListRevision = useCallback(() => {
    setDocumentListRevision((revision) => revision + 1);
  }, []);

  const mergeDocumentSummary = useCallback((nextDocument: DocumentSummary) => {
    setDocumentListRevision((revision) => revision + 1);
    setDocumentSummaries((currentDocumentSummaries) =>
      mergeSingleDocumentSummaryList(currentDocumentSummaries, nextDocument),
    );
  }, []);

  const mergeDocumentSummaries = useCallback(
    (nextDocuments: ReadonlyArray<DocumentSummary>) => {
      setDocumentListRevision((revision) => revision + 1);
      setDocumentSummaries((currentDocumentSummaries) =>
        mergeDocumentSummaryLists(
          currentDocumentSummaries,
          nextDocuments.filter((nextDocument) =>
            currentDocumentSummaries.some(
              (currentDocument) => currentDocument.id === nextDocument.id,
            ),
          ),
        ),
      );
    },
    [],
  );

  const {
    loadDocumentSummary,
    loadOrphanedDocumentSummary,
    loadRouteDocumentSummary,
  } = useExplorerDocumentSummaryLoaders({
    currentOrganizationId,
    dbStatus,
    documentQueries,
    mergeDocumentSummary,
  });

  useTrackedDocumentSummarySubscription({
    containerId,
    domainScope,
    setDocumentListRevision,
    setDocumentSummaries,
    symcrypt,
  });

  return {
    bumpDocumentListRevision,
    documentListRevision,
    documentSummaries,
    loadDocumentSummary,
    loadOrphanedDocumentSummary,
    loadRouteDocumentSummary,
    mergeDocumentSummaries,
    mergeDocumentSummary,
  };
}
