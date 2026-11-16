import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getStoredDocumentTypeLabel,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../../document-types/projectors";
import { getDocumentTypeDefinition } from "../../../../document-types/registry";
import { DocumentHistoryViewContext } from "../../../../stores/document-history/historicalDocumentView";
import {
  type DocumentHistoryControls,
  useDocumentHistory,
} from "../../../../stores/document-history/useDocumentHistory";
import { EXPLORER_LABELS } from "../../labels";
import { useExplorerDocumentSummary } from "../document/useExplorerDocumentSummary";
import { DocumentHistoryTimeline } from "./DocumentHistoryTimeline";
import { describeDocumentHistoryChange } from "./describeDocumentHistoryChange";

type ReadyHistory = Extract<
  DocumentHistoryControls["state"],
  { status: "ready" }
>;

/**
 * The document at the stop on screen, rendered by its own document type. The
 * type opens the live document as usual; the history view context makes it
 * show the past version read-only.
 */
function DocumentAtStop(params: {
  documentSummary: DocumentSummary;
  shown: NonNullable<ReadyHistory["shown"]>;
}) {
  const { documentSummary, shown } = params;
  const DocumentApp = getDocumentTypeDefinition(shown.view.documentKind).App;

  return (
    <div className="explorer-inline-note">
      <DocumentHistoryViewContext.Provider value={shown.view}>
        <DocumentApp
          localId={documentSummary.id}
          readOnly
          {...(documentSummary.containerId === null
            ? {}
            : { containerId: documentSummary.containerId })}
          {...(documentSummary.documentId === null
            ? {}
            : { documentId: documentSummary.documentId })}
        />
      </DocumentHistoryViewContext.Provider>
    </div>
  );
}

function ReadyDocumentHistory(params: {
  controls: DocumentHistoryControls;
  documentSummary: DocumentSummary;
  state: ReadyHistory;
}) {
  const { controls, documentSummary, state } = params;
  const { shown } = state;
  // The stop on screen lags the selected one while it replays; its summary
  // would describe a different change, so show none until it catches up.
  const changeSummary = useMemo(
    () =>
      shown !== null && shown.index === state.selectedIndex
        ? describeDocumentHistoryChange(shown.change)
        : null,
    [shown, state.selectedIndex],
  );

  return (
    <>
      <DocumentHistoryTimeline
        changeSummary={changeSummary}
        committedAt={
          state.history.stops[state.selectedIndex]?.committedAt ?? null
        }
        newerAvailable={state.newerAvailable}
        onReload={controls.reload}
        onSeek={controls.seek}
        onStep={controls.step}
        onTogglePlay={controls.togglePlay}
        playing={state.playing}
        selectedIndex={state.selectedIndex}
        stopCount={state.history.stops.length}
      />
      {shown === null ? (
        <MiniAppStatus busy>
          {EXPLORER_LABELS.documentHistoryLoading}
        </MiniAppStatus>
      ) : (
        <DocumentAtStop documentSummary={documentSummary} shown={shown} />
      )}
    </>
  );
}

function DocumentHistoryBody(params: {
  controls: DocumentHistoryControls;
  documentSummary: DocumentSummary | null;
  documentSummaryError: string | null;
}) {
  const { controls, documentSummary, documentSummaryError } = params;
  const { state } = controls;
  const failure =
    documentSummaryError ?? (state.status === "failed" ? state.message : null);
  if (failure !== null) {
    return (
      <MiniAppStatus tone="error">
        {`${EXPLORER_LABELS.documentHistoryFailed}: ${failure}`}
      </MiniAppStatus>
    );
  }
  if (state.status === "unavailable") {
    return (
      <MiniAppStatus>
        {EXPLORER_LABELS.documentHistoryUnavailable}
      </MiniAppStatus>
    );
  }
  if (state.status !== "ready" || documentSummary === null) {
    return (
      <MiniAppStatus busy>
        {EXPLORER_LABELS.documentHistoryLoading}
      </MiniAppStatus>
    );
  }
  return (
    <ReadyDocumentHistory
      controls={controls}
      documentSummary={documentSummary}
      state={state}
    />
  );
}

/**
 * A document's history: a timeline of every change and the document as it was
 * at the selected one. The live document keeps editing and syncing underneath.
 */
export function ExplorerDocumentHistoryPanel(params: {
  fallbackDocumentSummary: DocumentSummary | null;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  localId: string;
}) {
  const { documentSummary, documentSummaryError } = useExplorerDocumentSummary({
    fallbackDocumentSummary: params.fallbackDocumentSummary,
    loadDocumentSummary: params.loadDocumentSummary,
    localId: params.localId,
  });
  const controls = useDocumentHistory(params.localId);
  const { state } = controls;
  const shown = state.status === "ready" ? state.shown : null;
  const documentKind =
    shown?.view.documentKind ??
    documentSummary?.documentKind ??
    DEFAULT_DOCUMENT_KIND;

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--note explorer-detail--document-history"
      key={params.localId}
    >
      <MiniAppHeader>
        <MiniAppHeaderCopy>
          <strong>{shown?.view.title ?? documentSummary?.title ?? ""}</strong>
          <span>
            {`${EXPLORER_LABELS.documentHistorySubtitle} · ${getStoredDocumentTypeLabel(
              documentKind,
              APP_DOCUMENT_PROJECTOR_DEFINITIONS,
            )}`}
          </span>
        </MiniAppHeaderCopy>
      </MiniAppHeader>
      <DocumentHistoryBody
        controls={controls}
        documentSummary={documentSummary}
        documentSummaryError={documentSummaryError}
      />
    </MiniAppPanel>
  );
}
