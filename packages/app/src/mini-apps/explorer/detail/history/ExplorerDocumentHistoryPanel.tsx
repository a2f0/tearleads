import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
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
import { isCurrentDocumentVersion } from "../../../../stores/document-history/documentHistoryMachine";
import { DocumentHistoryViewContext } from "../../../../stores/document-history/historicalDocumentView";
import {
  type DocumentHistoryControls,
  useDocumentHistory,
} from "../../../../stores/document-history/useDocumentHistory";
import { DocumentsProvider } from "../../../../stores/documents/DocumentsProvider";
import { formatMiniAppDateTimeSeconds } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import { useExplorerDocumentSummary } from "../document/useExplorerDocumentSummary";
import { DocumentHistoryRestore } from "./DocumentHistoryRestore";
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
  /** The selected stop is still replaying; this is the one before it. */
  replaying: boolean;
  shown: NonNullable<ReadyHistory["shown"]>;
}) {
  const { documentSummary, replaying, shown } = params;
  const DocumentApp = getDocumentTypeDefinition(shown.view.documentKind).App;

  return (
    <div
      aria-busy={replaying}
      className="explorer-inline-note explorer-document-history-view"
    >
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
  readOnly: boolean;
  state: ReadyHistory;
}) {
  const { controls, documentSummary, readOnly, state } = params;
  const { shown } = state;
  const changeTime = formatMiniAppDateTimeSeconds(
    state.history.stops[state.selectedIndex]?.committedAt ?? null,
    { emptyFallback: EXPLORER_LABELS.documentHistoryTimeUnknown },
  );
  // The stop on screen lags the selected one while it replays; its summary
  // and its restore would describe a different change, so offer neither
  // until it catches up.
  const settled =
    shown !== null && shown.index === state.selectedIndex ? shown : null;
  const changeSummary = useMemo(
    () =>
      settled === null ? null : describeDocumentHistoryChange(settled.change),
    [settled],
  );

  return (
    // The live document: the restore reads its write access and writes
    // through it, and the document type below opens this same store.
    <DocumentsProvider
      initialDocumentKind={
        documentSummary.documentKind ?? DEFAULT_DOCUMENT_KIND
      }
      localId={documentSummary.id}
      readOnly={readOnly}
      {...(documentSummary.containerId === null
        ? {}
        : { containerId: documentSummary.containerId })}
      {...(documentSummary.documentId === null
        ? {}
        : { documentId: documentSummary.documentId })}
    >
      <DocumentHistoryTimeline
        actions={
          settled === null ? null : (
            <DocumentHistoryRestore
              index={settled.index}
              isLatest={isCurrentDocumentVersion(state, settled.index)}
              onRestored={controls.reload}
              versionTime={changeTime}
              view={settled.view}
            />
          )
        }
        changeSummary={changeSummary}
        changeTime={changeTime}
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
        <DocumentAtStop
          documentSummary={documentSummary}
          replaying={settled === null}
          shown={shown}
        />
      )}
    </DocumentsProvider>
  );
}

function DocumentHistoryBody(params: {
  controls: DocumentHistoryControls;
  documentSummary: DocumentSummary;
  isContainerReadOnly: (containerId: string | null) => boolean;
}) {
  const { controls, documentSummary } = params;
  const { state } = controls;
  if (state.status === "failed") {
    return (
      <MiniAppStatus tone="error">
        {`${EXPLORER_LABELS.documentHistoryFailed}: ${state.message}`}
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
  if (state.status !== "ready") {
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
      // The folder the document is in now, not the one the route names: a
      // stale or bookmarked route must not unlock a document since trashed.
      readOnly={params.isContainerReadOnly(documentSummary.containerId)}
      state={state}
    />
  );
}

function DocumentHistoryHeader(params: {
  documentKind: StoredDocumentKind | null;
  title: string;
}) {
  const typeLabel =
    params.documentKind === null
      ? null
      : getStoredDocumentTypeLabel(
          params.documentKind,
          APP_DOCUMENT_PROJECTOR_DEFINITIONS,
        );
  return (
    <MiniAppHeader>
      <MiniAppHeaderCopy>
        <strong>{params.title}</strong>
        <span>
          {typeLabel === null
            ? EXPLORER_LABELS.documentHistorySubtitle
            : `${EXPLORER_LABELS.documentHistorySubtitle} · ${typeLabel}`}
        </span>
      </MiniAppHeaderCopy>
    </MiniAppHeader>
  );
}

/**
 * The history of a document the route was admitted to. Only this component
 * opens the history, so nothing of a document is read before its summary
 * has loaded.
 */
function AdmittedDocumentHistory(params: {
  documentSummary: DocumentSummary;
  isContainerReadOnly: (containerId: string | null) => boolean;
}) {
  const { documentSummary } = params;
  const controls = useDocumentHistory(documentSummary.id);
  const { state } = controls;
  const shown = state.status === "ready" ? state.shown : null;

  return (
    <>
      <DocumentHistoryHeader
        documentKind={
          shown?.view.documentKind ??
          documentSummary.documentKind ??
          DEFAULT_DOCUMENT_KIND
        }
        title={shown?.view.title ?? documentSummary.title}
      />
      <DocumentHistoryBody
        controls={controls}
        documentSummary={documentSummary}
        isContainerReadOnly={params.isContainerReadOnly}
      />
    </>
  );
}

/**
 * A document's history: a timeline of every change and the document as it was
 * at the selected one. The live document keeps editing and syncing underneath.
 */
export function ExplorerDocumentHistoryPanel(params: {
  fallbackDocumentSummary: DocumentSummary | null;
  /** Whether documents in a container are read-only, as in the Trash. */
  isContainerReadOnly: (containerId: string | null) => boolean;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  localId: string;
}) {
  const { documentSummary, documentSummaryError, isLoadingDocumentSummary } =
    useExplorerDocumentSummary({
      fallbackDocumentSummary: params.fallbackDocumentSummary,
      loadDocumentSummary: params.loadDocumentSummary,
      localId: params.localId,
    });

  return (
    <MiniAppPanel
      className="explorer-detail explorer-detail--note explorer-detail--document-history"
      key={params.localId}
    >
      {documentSummary === null ? (
        // The route named a document whose summary has not loaded, failed to
        // load, or was refused (an orphan the active organization does not
        // own). Its history stays closed: even a title is its content.
        <>
          <DocumentHistoryHeader documentKind={null} title="" />
          <UnadmittedDocumentStatus
            error={documentSummaryError}
            loading={isLoadingDocumentSummary}
          />
        </>
      ) : (
        <AdmittedDocumentHistory
          documentSummary={documentSummary}
          isContainerReadOnly={params.isContainerReadOnly}
        />
      )}
    </MiniAppPanel>
  );
}

function UnadmittedDocumentStatus(params: {
  error: string | null;
  loading: boolean;
}) {
  if (params.error !== null) {
    return (
      <MiniAppStatus tone="error">
        {`${EXPLORER_LABELS.documentHistoryFailed}: ${params.error}`}
      </MiniAppStatus>
    );
  }
  return params.loading ? (
    <MiniAppStatus busy>{EXPLORER_LABELS.documentHistoryLoading}</MiniAppStatus>
  ) : (
    <MiniAppStatus>
      {EXPLORER_LABELS.documentHistoryDocumentUnavailable}
    </MiniAppStatus>
  );
}
