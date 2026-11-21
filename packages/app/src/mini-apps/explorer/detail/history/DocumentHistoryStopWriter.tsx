import type { DocumentHistoryStop } from "@tearleads/client-sdk";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import { useMemo } from "react";
import { resolveDocumentHistoryStopWriter } from "../../../../stores/document-history/documentHistoryWriter";
import { EXPLORER_LABELS } from "../../labels";
import {
  type ExplorerAttributionUserLabelResolver,
  getExplorerAttributionWriterLabel,
  getExplorerAttributionWriterTitle,
} from "../attributionDisplay";

/**
 * Who uploaded the selected stop, from the live document's edit attribution:
 * its compact segments, or its per-upload ranges, which carry the same
 * identity for each run of operations. Nothing is shown when the uploader is
 * unknown: offline, unsynced, ambiguous, or delivered by a rotation baseline.
 */
export function DocumentHistoryStopWriter(params: {
  resolveUserLabel?: ExplorerAttributionUserLabelResolver | undefined;
  segments: ReadonlyArray<DocumentEditAttributionResponse["segments"][number]>;
  stop: DocumentHistoryStop;
}) {
  const { resolveUserLabel, segments, stop } = params;
  const writer = useMemo(
    () => resolveDocumentHistoryStopWriter(segments, stop),
    [segments, stop],
  );
  const label =
    writer === null
      ? ""
      : getExplorerAttributionWriterLabel(writer, resolveUserLabel);
  if (writer === null || label.length === 0) {
    return null;
  }

  return (
    <span title={getExplorerAttributionWriterTitle(writer, resolveUserLabel)}>
      {`${EXPLORER_LABELS.documentHistoryUploadedBy} ${label}`}
    </span>
  );
}
