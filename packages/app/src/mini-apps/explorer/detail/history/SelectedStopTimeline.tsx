import type { DocumentSummary } from "@tearleads/client-sdk";
import { useMemo } from "react";
import { isCurrentDocumentVersion } from "../../../../stores/document-history/documentHistoryMachine";
import {
  boundDocumentHistoryStopTime,
  resolveDocumentHistoryStopUploadedAt,
} from "../../../../stores/document-history/documentHistoryUploadTime";
import type { DocumentHistoryControls } from "../../../../stores/document-history/useDocumentHistory";
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
import { describeDocumentHistoryChange } from "./describeDocumentHistoryChange";
import type { ExplorerDocumentVersionCopy } from "./useExplorerDocumentVersionCopy";

export type ReadyHistory = Extract<
  DocumentHistoryControls["state"],
  { status: "ready" }
>;

export type SettledStop = NonNullable<ReadyHistory["shown"]>;

/**
 * When the selected stop's change was made, as shown: its device's time,
 * bounded by when the server stored the upload that delivered it. Null while
 * the uploads are first read: the device's time alone could be a day ahead,
 * and a confirmation open on it would then change under the reader.
 */
function useSelectedStopTime(
  selectedStop: ReadyHistory["history"]["stops"][number] | undefined,
  uploads: DocumentAttributionRanges | null,
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
 * The timeline for the selected stop: when the change was made, who uploaded
 * it, what it changed, and what can be done with the version. It must render
 * under the live document's provider, which the restore and the writer are
 * read through. `uploads` are the live document's upload ranges, read above
 * History's reload so a reload does not read them again; null until their
 * first read settles.
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
  versionCopy: ExplorerDocumentVersionCopy;
}) {
  const { controls, documentSummary, settled, state, versionCopy } = params;
  const selectedStop = state.history.stops[state.selectedIndex];
  const changeTime = useSelectedStopTime(selectedStop, params.uploads);
  const changeSummary = useMemo(
    () =>
      settled === null ? null : describeDocumentHistoryChange(settled.change),
    [settled],
  );

  return (
    <DocumentHistoryTimeline
      actions={
        <div className="explorer-document-history-actions">
          {settled === null ? null : (
            <DocumentHistoryRestore
              index={settled.index}
              isLatest={isCurrentDocumentVersion(state, settled.index)}
              // Choosing a stop stops playback, including the one on screen.
              onRequested={() => controls.seek(settled.index)}
              onRestored={controls.reload}
              versionTime={changeTime.label}
              view={settled.view}
            />
          )}
          {/* Stays mounted while a stop replays: a copy in flight reports
              on whichever stop is selected when it finishes. */}
          <DocumentHistoryCopy
            control={params.copyControl}
            copy={versionCopy}
            documentSummary={documentSummary}
            index={state.selectedIndex}
            onRequested={() => controls.seek(state.selectedIndex)}
            versionTime={changeTime.label}
            view={settled?.view ?? null}
          />
        </div>
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
      selectedIndex={state.selectedIndex}
      stopCount={state.history.stops.length}
      writer={
        selectedStop === undefined ? null : (
          <DocumentHistoryStopWriter
            resolveUserLabel={params.attributionUserLabelResolver}
            stop={selectedStop}
          />
        )
      }
    />
  );
}
