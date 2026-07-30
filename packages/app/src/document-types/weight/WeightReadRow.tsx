import { useState } from "react";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { DocumentRowDetailOverlay } from "../shared/DocumentRowDetail";
import { formatRowAttribution } from "../shared/rowAttribution";
import { TrackerReadActions } from "../shared/TrackerReadActions";
import "../shared/TrackerFormControls.css";
import {
  formatMeasuredAt,
  formatWeight,
  formatWeightChange,
  toWeightEntryDetailFields,
  type WeightEntryRow,
} from "./weightEntries";

// One saved entry as a card, which is how the editor collapses a row the user has
// finished with: the weight and how it moved since the previous entry, a kebab
// that opens a small actions menu (Edit / Attribution), and the row's last-edit
// attribution line. Read mode presents the same entries as a sortable table
// instead — see WeightReadTable.
export function WeightEntryReadRow(params: {
  currentAuthorId: string | null;
  entry: WeightEntryRow;
  index: number;
  onEnterEdit?: (() => void) | undefined;
  previous: WeightEntryRow | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const {
    currentAuthorId,
    entry,
    index,
    onEnterEdit,
    previous,
    resolveRowWriter,
  } = params;
  const [detailOpen, setDetailOpen] = useState(false);
  const notes = entry.notes.trim();
  // Prefer the server-verified writer for this entry's last edit; fall back to
  // the row's self-attested author when attribution is unavailable.
  const updatedBy = resolveRowWriter?.(entry.updatedByPeer) ?? entry.updatedBy;
  const createdBy = resolveRowWriter?.(entry.createdByPeer) ?? entry.createdBy;
  const attribution = formatRowAttribution({
    currentAuthorId,
    updatedAt: entry.updatedAt,
    updatedBy,
  });
  const change = formatWeightChange(entry, previous);
  const detailFields = toWeightEntryDetailFields(entry, resolveRowWriter);

  return (
    <>
      <div className="weight-entry-read-row tracker-read-row">
        <span className="tracker-read-cell">
          <strong>Weight</strong>
          <span className="tracker-read-value">{formatWeight(entry)}</span>
        </span>
        <span className="tracker-read-cell">
          <strong>Change</strong>
          <span className="tracker-read-value">{change ?? "—"}</span>
        </span>
        <span className="tracker-read-cell">
          <strong>Measured</strong>
          <span className="tracker-read-value">{formatMeasuredAt(entry)}</span>
        </span>
        <span className="tracker-read-index">{index + 1}</span>
        <TrackerReadActions
          actionsAriaLabel={`Entry ${index + 1} actions`}
          detailLabel="Attribution"
          detailsOpen={detailOpen}
          directAriaLabel={`Entry ${index + 1} attribution`}
          onEnterEdit={onEnterEdit}
          onOpenDetails={() => setDetailOpen(true)}
        />
        {notes.length > 0 ? (
          <span className="tracker-read-notes" title={notes}>
            {notes}
          </span>
        ) : null}
        {attribution ? (
          <span className="tracker-read-attribution">{attribution}</span>
        ) : null}
      </div>
      {detailOpen ? (
        <DocumentRowDetailOverlay
          createdAt={entry.createdAt}
          createdBy={createdBy}
          currentAuthorId={currentAuthorId}
          fields={detailFields}
          onClose={() => setDetailOpen(false)}
          showFieldValues={false}
          title={`Entry ${index + 1}`}
          updatedAt={entry.updatedAt}
          updatedBy={updatedBy}
        />
      ) : null}
    </>
  );
}
