import type {
  DocumentHistoryStop,
  DocumentHistoryVerifiedRange,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { resolveDocumentHistoryStopWriter } from "../../../../stores/document-history/documentHistoryWriter";
import { useDocumentAttributionSegments } from "../../../../stores/documents/useDocumentRowWriters";
import { EXPLORER_LABELS } from "../../labels";
import {
  type ExplorerAttributionUserLabelResolver,
  getExplorerAttributionWriterLabel,
  getExplorerAttributionWriterTitle,
} from "../attributionDisplay";

/**
 * Who uploaded the selected stop. Once a check has verified the history on
 * this device, its ranges say; until then the live document's edit
 * attribution does, as the server reports it. It must render under the live
 * document's provider. Nothing is shown when the uploader is unknown:
 * offline, unsynced, ambiguous, or delivered by a rotation baseline.
 */
export function DocumentHistoryStopWriter(params: {
  resolveUserLabel?: ExplorerAttributionUserLabelResolver | undefined;
  stop: DocumentHistoryStop;
  /** The uploads a check verified here; null when none has. */
  verifiedRanges?: ReadonlyArray<DocumentHistoryVerifiedRange> | null;
}) {
  const { resolveUserLabel, stop } = params;
  const verifiedRanges = params.verifiedRanges ?? null;
  const segments = useDocumentAttributionSegments(true);
  const writer = useMemo(
    () => resolveDocumentHistoryStopWriter(verifiedRanges ?? segments, stop),
    [segments, stop, verifiedRanges],
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
