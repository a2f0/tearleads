import type {
  DocumentHistoryVerifiedRange,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { isCurrentDocumentVersion } from "../../../../stores/document-history/documentHistoryMachine";
import { resolveDocumentHistoryStopProvenance } from "../../../../stores/document-history/documentHistoryProvenance";
import {
  boundDocumentHistoryStopTime,
  resolveDocumentHistoryStopUploadedAt,
} from "../../../../stores/document-history/documentHistoryUploadTime";
import { verifiedDocumentHistoryRanges } from "../../../../stores/document-history/documentHistoryVerificationMachine";
import type { DocumentHistoryControls } from "../../../../stores/document-history/useDocumentHistory";
import type { DocumentHistoryVerificationControls } from "../../../../stores/document-history/useDocumentHistoryVerification";
import type { DocumentAttributionRanges } from "../../../../stores/documents/useDocumentAttributionRanges";
import { formatMiniAppDateTimeSeconds } from "../../../../utils/formatMiniAppDate";
import { EXPLORER_LABELS } from "../../labels";
import type { ExplorerAttributionUserLabelResolver } from "../attributionDisplay";
import {
  DocumentHistoryCopy,
  type DocumentHistoryCopyControl,
} from "./DocumentHistoryCopy";
import { DocumentHistoryRestore } from "./DocumentHistoryRestore";
import { DocumentHistoryStopWriter } from "./DocumentHistoryStopWriter";
import { DocumentHistoryTimeline } from "./DocumentHistoryTimeline";
import { DocumentHistoryVerification } from "./DocumentHistoryVerification";
import { describeDocumentHistoryChange } from "./describeDocumentHistoryChange";
import type { ExplorerDocumentVersionCopy } from "./useExplorerDocumentVersionCopy";

export type ReadyHistory = Extract<
  DocumentHistoryControls["state"],
  { status: "ready" }
>;

export type SettledStop = NonNullable<ReadyHistory["shown"]>;

type SelectedStop = ReadyHistory["history"]["stops"][number];
type VerifiedRanges = ReadonlyArray<DocumentHistoryVerifiedRange>;

/**
 * When the selected stop's change was made, as shown: its device's time,
 * bounded by when the server stored the upload that delivered it. Null while
 * the uploads are first read: the device's time alone could be a day ahead,
 * and a confirmation open on it would then change under the reader.
 */
function useSelectedStopTime(
  selectedStop: SelectedStop | undefined,
  uploads: DocumentAttributionRanges | VerifiedRanges | null,
): { readonly clockAhead: boolean; readonly label: string | null } {
  return useMemo(() => {
    if (uploads === null) return { clockAhead: false, label: null };
    // A change cannot have been made after the server stored it.
    const stopTime = boundDocumentHistoryStopTime(
      selectedStop?.committedAt ?? null,
      selectedStop === undefined
        ? null
        : resolveDocumentHistoryStopUploadedAt(uploads, selectedStop),
    );
    return {
      clockAhead: stopTime.clockAhead,
      label: formatMiniAppDateTimeSeconds(stopTime.at, {
        emptyFallback: EXPLORER_LABELS.documentHistoryTimeUnknown,
      }),
    };
  }, [selectedStop, uploads]);
}

/**
 * Where the server's signed history holds the selected stop, in words; null
 * until a check has verified the history on this device.
 */
function useSelectedStopProvenance(
  selectedStop: SelectedStop | undefined,
  verifiedRanges: VerifiedRanges | null,
): string | null {
  return useMemo(
    () =>
      selectedStop === undefined || verifiedRanges === null
        ? null
        : EXPLORER_LABELS.documentHistoryVerifyProvenance[
            resolveDocumentHistoryStopProvenance(verifiedRanges, selectedStop)
          ],
    [selectedStop, verifiedRanges],
  );
}

/** What can be done with the version on screen: restore it, or copy it. */
function SelectedStopActions(params: {
  controls: DocumentHistoryControls;
  copyControl: DocumentHistoryCopyControl;
  documentSummary: DocumentSummary;
  settled: SettledStop | null;
  state: ReadyHistory;
  versionCopy: ExplorerDocumentVersionCopy;
  versionTime: string | null;
}) {
  const { controls, settled, state, versionTime } = params;
  return (
    <div className="explorer-document-history-actions">
      {settled === null ? null : (
        <DocumentHistoryRestore
          index={settled.index}
          isLatest={isCurrentDocumentVersion(state, settled.index)}
          // Choosing a stop stops playback, including the one on screen.
          onRequested={() => controls.seek(settled.index)}
          onRestored={controls.reload}
          versionTime={versionTime}
          view={settled.view}
        />
      )}
      {/* Stays mounted while a stop replays: a copy in flight reports
          on whichever stop is selected when it finishes. */}
      <DocumentHistoryCopy
        control={params.copyControl}
        copy={params.versionCopy}
        documentSummary={params.documentSummary}
        index={state.selectedIndex}
        onRequested={() => controls.seek(state.selectedIndex)}
        versionTime={versionTime}
        view={settled?.view ?? null}
      />
    </div>
  );
}

/**
 * The timeline for the selected stop: when the change was made, who uploaded
 * it, what it changed, whether the history was checked, and what can be done
 * with the version. It must render under the live document's provider, which
 * the restore and the writer are read through. `uploads` are the live
 * document's upload ranges, read above History's reload so a reload does not
 * read them again; null until their first read settles. Once a check has
 * verified the history on this device, its ranges take their place: who and
 * when then come from uploads this device authenticated, not from what the
 * server reports.
 */
export function SelectedStopTimeline(params: {
  attributionUserLabelResolver:
    | ExplorerAttributionUserLabelResolver
    | undefined;
  controls: DocumentHistoryControls;
  copyControl: DocumentHistoryCopyControl;
  documentSummary: DocumentSummary;
  /** The selected stop once it is on screen; null while it replays. */
  settled: SettledStop | null;
  state: ReadyHistory;
  uploads: DocumentAttributionRanges | null;
  verification: DocumentHistoryVerificationControls;
  versionCopy: ExplorerDocumentVersionCopy;
}) {
  const { controls, settled, state, verification } = params;
  const selectedStop = state.history.stops[state.selectedIndex];
  const verifiedRanges = verifiedDocumentHistoryRanges(
    verification.state,
    state.source,
  );
  const changeTime = useSelectedStopTime(
    selectedStop,
    verifiedRanges ?? params.uploads,
  );
  const provenance = useSelectedStopProvenance(selectedStop, verifiedRanges);
  const changeSummary = useMemo(
    () =>
      settled === null ? null : describeDocumentHistoryChange(settled.change),
    [settled],
  );

  return (
    <DocumentHistoryTimeline
      actions={
        <SelectedStopActions
          controls={controls}
          copyControl={params.copyControl}
          documentSummary={params.documentSummary}
          settled={settled}
          state={state}
          versionCopy={params.versionCopy}
          versionTime={changeTime.label}
        />
      }
      changeSummary={changeSummary}
      changeTime={
        changeTime.label ?? EXPLORER_LABELS.documentHistoryTimeChecking
      }
      changeTimeNote={
        changeTime.clockAhead ? EXPLORER_LABELS.documentHistoryClockAhead : null
      }
      newerAvailable={state.newerAvailable}
      onReload={controls.reload}
      onSeek={controls.seek}
      onStep={controls.step}
      onTogglePlay={controls.togglePlay}
      playing={state.playing}
      provenance={provenance}
      selectedIndex={state.selectedIndex}
      stopCount={state.history.stops.length}
      verification={
        <DocumentHistoryVerification
          onShowLocal={controls.showLocal}
          onShowSigned={controls.showSigned}
          source={state.source}
          verification={verification}
        />
      }
      writer={
        selectedStop === undefined ? null : (
          <DocumentHistoryStopWriter
            resolveUserLabel={params.attributionUserLabelResolver}
            stop={selectedStop}
            verifiedRanges={verifiedRanges}
          />
        )
      }
    />
  );
}
