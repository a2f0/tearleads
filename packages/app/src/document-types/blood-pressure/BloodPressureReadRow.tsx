import { useState } from "react";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { DocumentRowDetailOverlay } from "../shared/DocumentRowDetail";
import { formatRowAttribution } from "../shared/rowAttribution";
import { TrackerReadActions } from "../shared/TrackerReadActions";
import "../shared/TrackerFormControls.css";
import {
  type BloodPressureReadingRow,
  formatMeasuredAt,
  formatMeasurementPair,
  formatPulse,
  toBloodPressureReadingDetailFields,
} from "./bloodPressureReadings";

// One saved reading as a card, which is how the editor collapses a row the user
// has finished with: the summary cells, a kebab that opens a small actions menu
// (Edit / Attribution), and the row's last-edit attribution line. Read mode
// presents the same readings as a sortable table instead — see
// BloodPressureReadTable.
export function BloodPressureReadingReadRow(params: {
  currentAuthorId: string | null;
  index: number;
  onEnterEdit?: (() => void) | undefined;
  reading: BloodPressureReadingRow;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const { currentAuthorId, index, onEnterEdit, reading, resolveRowWriter } =
    params;
  const [detailOpen, setDetailOpen] = useState(false);
  const notes = reading.notes.trim();
  // Prefer the server-verified writer for this reading's last edit; fall back to
  // the row's self-attested author when attribution is unavailable.
  const updatedBy =
    resolveRowWriter?.(reading.updatedByPeer) ?? reading.updatedBy;
  const createdBy =
    resolveRowWriter?.(reading.createdByPeer) ?? reading.createdBy;
  const attribution = formatRowAttribution({
    currentAuthorId,
    updatedAt: reading.updatedAt,
    updatedBy,
  });
  const detailFields = toBloodPressureReadingDetailFields(
    reading,
    resolveRowWriter,
  );

  return (
    <>
      <div className="blood-pressure-reading-read-row tracker-read-row">
        <span className="tracker-read-cell">
          <strong>Reading</strong>
          <span className="tracker-read-value">
            {formatMeasurementPair(reading)}
          </span>
        </span>
        <span className="tracker-read-cell">
          <strong>Pulse</strong>
          <span className="tracker-read-value">{formatPulse(reading)}</span>
        </span>
        <span className="tracker-read-cell">
          <strong>Measured</strong>
          <span className="tracker-read-value">
            {formatMeasuredAt(reading)}
          </span>
        </span>
        <span className="tracker-read-index">{index + 1}</span>
        <TrackerReadActions
          actionsAriaLabel={`Reading ${index + 1} actions`}
          detailLabel="Attribution"
          detailsOpen={detailOpen}
          directAriaLabel={`Reading ${index + 1} attribution`}
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
          createdAt={reading.createdAt}
          createdBy={createdBy}
          currentAuthorId={currentAuthorId}
          fields={detailFields}
          onClose={() => setDetailOpen(false)}
          showFieldValues={false}
          title={`Reading ${index + 1}`}
          updatedAt={reading.updatedAt}
          updatedBy={updatedBy}
        />
      ) : null}
    </>
  );
}
