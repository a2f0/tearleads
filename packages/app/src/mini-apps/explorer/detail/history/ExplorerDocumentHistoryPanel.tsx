import {
  DEFAULT_DOCUMENT_KIND,
  type DocumentSummary,
  getStoredDocumentTypeLabel,
  type StoredDocumentKind,
} from "@tearleads/client-sdk";
import { type ReactNode, useEffect, useState } from "react";
import {
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppPanel,
  MiniAppStatus,
} from "../../../../components/mini-app/MiniAppLayout";
import { APP_DOCUMENT_PROJECTOR_DEFINITIONS } from "../../../../document-types/projectors";
import { getDocumentTypeDefinition } from "../../../../document-types/registry";
import { useTearleads } from "../../../../providers/sdk/TearleadsProvider";
import { localDocumentHistory } from "../../../../stores/document-history/documentHistoryMachine";
import { DocumentHistoryViewContext } from "../../../../stores/document-history/historicalDocumentView";
import {
  type DocumentHistoryControls,
  useDocumentHistory,
} from "../../../../stores/document-history/useDocumentHistory";
import {
  type DocumentHistoryVerificationControls,
  useDocumentHistoryVerification,
} from "../../../../stores/document-history/useDocumentHistoryVerification";
import { DocumentsProvider } from "../../../../stores/documents/DocumentsProvider";
import {
  type DocumentAttributionRanges,
  useDocumentAttributionRanges,
} from "../../../../stores/documents/useDocumentAttributionRanges";
import { EXPLORER_LABELS } from "../../labels";
import type { ExplorerAttributionUserLabelResolver } from "../attributionDisplay";
import { useExplorerDocumentSummary } from "../document/useExplorerDocumentSummary";
import {
  type DocumentHistoryCopyControl,
  useDocumentHistoryCopyControl,
} from "./DocumentHistoryCopy";
import {
  type ReadyHistory,
  SelectedStopTimeline,
} from "./SelectedStopTimeline";
import type { ExplorerDocumentVersionCopy } from "./useExplorerDocumentVersionCopy";

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

interface DocumentHistoryBodyProps {
  attributionUserLabelResolver:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  controls: DocumentHistoryControls;
  copyControl: DocumentHistoryCopyControl;
  documentSummary: DocumentSummary;
  /** The live document's upload ranges; null until first read. */
  uploads: DocumentAttributionRanges | null;
  /** The check of this device's capture against the signed uploads. */
  verification: DocumentHistoryVerificationControls;
  versionCopy: ExplorerDocumentVersionCopy;
}

function ReadyDocumentHistory(
  params: DocumentHistoryBodyProps & { state: ReadyHistory },
) {
  const { documentSummary, state } = params;
  const { shown } = state;
  // The stop on screen lags the selected one while it replays; its summary
  // and its restore would describe a different change, so offer neither
  // until it catches up.
  const settled =
    shown !== null && shown.index === state.selectedIndex ? shown : null;

  return (
    <>
      <SelectedStopTimeline
        attributionUserLabelResolver={params.attributionUserLabelResolver}
        controls={params.controls}
        copyControl={params.copyControl}
        documentSummary={documentSummary}
        settled={settled}
        state={state}
        uploads={params.uploads}
        verification={params.verification}
        versionCopy={params.versionCopy}
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
    </>
  );
}

function DocumentHistoryBody(params: DocumentHistoryBodyProps) {
  const { controls } = params;
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
  return <ReadyDocumentHistory {...params} state={state} />;
}

/**
 * The body under the live document, with its upload ranges read here: above
 * the body's reload, so loading newer edits or restoring a version keeps
 * what was read instead of reading every page again.
 */
function LiveDocumentHistoryBody(
  params: Omit<DocumentHistoryBodyProps, "uploads">,
) {
  // When the server stored the upload behind each run of operations.
  const uploads = useDocumentAttributionRanges(true);
  return <DocumentHistoryBody {...params} uploads={uploads} />;
}

/**
 * The live document: the restore reads its write access and writes through
 * it, the uploads are read through it, and the document type at the stop
 * opens this same store.
 */
function LiveDocument(params: {
  children: ReactNode;
  documentSummary: DocumentSummary;
  readOnly: boolean;
}) {
  const { documentSummary } = params;
  return (
    <DocumentsProvider
      initialDocumentKind={
        documentSummary.documentKind ?? DEFAULT_DOCUMENT_KIND
      }
      localId={documentSummary.id}
      readOnly={params.readOnly}
      {...(documentSummary.containerId === null
        ? {}
        : { containerId: documentSummary.containerId })}
      {...(documentSummary.documentId === null
        ? {}
        : { documentId: documentSummary.documentId })}
    >
      {params.children}
    </DocumentsProvider>
  );
}

/**
 * True from the first render in which `ready` is, for as long as the caller
 * stays mounted: the live document opens with the first ready history and
 * stays open while History reloads.
 */
function useOpenedOnceReady(ready: boolean): boolean {
  const [opened, setOpened] = useState(ready);
  useEffect(() => {
    if (ready) setOpened(true);
  }, [ready]);
  return opened || ready;
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
  attributionUserLabelResolver:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  documentSummary: DocumentSummary;
  isContainerReadOnly: (containerId: string | null) => boolean;
  versionCopy: ExplorerDocumentVersionCopy;
}) {
  const { documentSummary } = params;
  const controls = useDocumentHistory(documentSummary.id);
  // Held here, above the timeline: History reloading unmounts the timeline,
  // and a copy in flight must still report when it is back.
  const copyControl = useDocumentHistoryCopyControl(params.versionCopy);
  const { state } = controls;
  // A check is of this device's capture, whichever history is on screen. A
  // reload brings another capture, and the check of the one before ends.
  const verification = useDocumentHistoryVerification(
    documentSummary.id,
    localDocumentHistory(state),
  );
  const shown = state.status === "ready" ? state.shown : null;
  const liveOpen = useOpenedOnceReady(state.status === "ready");
  const body = {
    attributionUserLabelResolver: params.attributionUserLabelResolver,
    controls,
    copyControl,
    documentSummary,
    verification,
    versionCopy: params.versionCopy,
  };

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
      {liveOpen ? (
        <LiveDocument
          documentSummary={documentSummary}
          // The folder the document is in now, not the one the route names:
          // a stale or bookmarked route must not unlock a document since
          // trashed.
          readOnly={params.isContainerReadOnly(documentSummary.containerId)}
        >
          <LiveDocumentHistoryBody {...body} />
        </LiveDocument>
      ) : (
        <DocumentHistoryBody {...body} uploads={null} />
      )}
    </>
  );
}

/**
 * A document's history: a timeline of every change and the document as it was
 * at the selected one. The live document keeps editing and syncing underneath.
 */
export function ExplorerDocumentHistoryPanel(params: {
  /** Names the uploader of a change; without it only a key id is shown. */
  attributionUserLabelResolver?:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  fallbackDocumentSummary: DocumentSummary | null;
  /** Whether documents in a container are read-only, as in the Trash. */
  isContainerReadOnly: (containerId: string | null) => boolean;
  loadDocumentSummary: (localId: string) => Promise<DocumentSummary | null>;
  localId: string;
  /** Saves a version as a new document beside this one. */
  versionCopy: ExplorerDocumentVersionCopy;
}) {
  const {
    documentSummary,
    documentSummaryError,
    isLoadingDocumentSummary,
    retry,
  } = useExplorerDocumentSummary({
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
            localId={params.localId}
            onDocumentSaved={retry}
          />
        </>
      ) : (
        <AdmittedDocumentHistory
          attributionUserLabelResolver={params.attributionUserLabelResolver}
          documentSummary={documentSummary}
          isContainerReadOnly={params.isContainerReadOnly}
          versionCopy={params.versionCopy}
        />
      )}
    </MiniAppPanel>
  );
}

/**
 * Why there is no history to show yet. A document opened from a cold link
 * may still be hydrating: its summary is asked for again each time the
 * document is saved, so History opens as soon as the route admits it.
 */
function UnadmittedDocumentStatus(params: {
  error: string | null;
  loading: boolean;
  localId: string;
  onDocumentSaved: () => void;
}) {
  const { localId, onDocumentSaved } = params;
  const { documents } = useTearleads();
  useEffect(
    () =>
      documents.subscribe((document) => {
        if (document.id === localId) onDocumentSaved();
      }),
    [documents, localId, onDocumentSaved],
  );

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
