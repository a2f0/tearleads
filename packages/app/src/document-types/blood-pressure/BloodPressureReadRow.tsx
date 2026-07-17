import { useState } from "react";
import { MiniAppRowActionsButton } from "../../components/shared/MiniAppTable";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  DocumentRowDetailOverlay,
  type RowDetailField,
} from "../shared/DocumentRowDetail";
import { formatRowAttribution } from "../shared/rowAttribution";
import {
  BLOOD_PRESSURE_DIASTOLIC_FIELD,
  BLOOD_PRESSURE_MEASURED_AT_FIELD,
  BLOOD_PRESSURE_NOTES_FIELD,
  BLOOD_PRESSURE_PULSE_FIELD,
  BLOOD_PRESSURE_SYSTOLIC_FIELD,
} from "./bloodPressureDocumentDefinition";
import {
  type BloodPressureReadingRow,
  formatMeasuredAt,
  formatMeasurementPair,
  formatPulse,
} from "./bloodPressureReadings";

// A single reading in read mode: the summary cells, a kebab that opens the
// per-reading detail overlay, and the row's last-edit attribution line.
export function BloodPressureReadingReadRow(params: {
  currentAuthorId: string | null;
  index: number;
  reading: BloodPressureReadingRow;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const { currentAuthorId, index, reading, resolveRowWriter } = params;
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

  // Resolve a single cell's verified writer for the drill-down; null when the
  // cell's editor is unknown (attribution not synced) so the overlay omits it.
  const fieldWriter = (field: string): string | null =>
    resolveRowWriter?.(reading.fieldEditors[field] ?? null) ?? null;
  const detailFields: RowDetailField[] = [
    {
      label: "Systolic",
      value: reading.systolic,
      writerUserId: fieldWriter(BLOOD_PRESSURE_SYSTOLIC_FIELD),
    },
    {
      label: "Diastolic",
      value: reading.diastolic,
      writerUserId: fieldWriter(BLOOD_PRESSURE_DIASTOLIC_FIELD),
    },
    {
      label: "Pulse",
      value: reading.pulse,
      writerUserId: fieldWriter(BLOOD_PRESSURE_PULSE_FIELD),
    },
    {
      label: "Measured at",
      value: formatMeasuredAt(reading),
      writerUserId: fieldWriter(BLOOD_PRESSURE_MEASURED_AT_FIELD),
    },
    {
      label: "Notes",
      value: reading.notes,
      writerUserId: fieldWriter(BLOOD_PRESSURE_NOTES_FIELD),
    },
  ];

  return (
    <>
      <div className="blood-pressure-reading-read-row">
        <span className="blood-pressure-reading-read-cell">
          <strong>Reading</strong>
          <span className="blood-pressure-reading-read-value">
            {formatMeasurementPair(reading)}
          </span>
        </span>
        <span className="blood-pressure-reading-read-cell">
          <strong>Pulse</strong>
          <span className="blood-pressure-reading-read-value">
            {formatPulse(reading)}
          </span>
        </span>
        <span className="blood-pressure-reading-read-cell">
          <strong>Measured</strong>
          <span className="blood-pressure-reading-read-value">
            {formatMeasuredAt(reading)}
          </span>
        </span>
        <span className="blood-pressure-reading-read-index">{index + 1}</span>
        <MiniAppRowActionsButton
          aria-expanded={detailOpen}
          aria-haspopup="dialog"
          aria-label={`Reading ${index + 1} details`}
          className="blood-pressure-reading-read-actions"
          onClick={() => setDetailOpen(true)}
        />
        {notes.length > 0 ? (
          <span className="blood-pressure-reading-read-notes" title={notes}>
            {notes}
          </span>
        ) : null}
        {attribution ? (
          <span className="blood-pressure-reading-read-attribution">
            {attribution}
          </span>
        ) : null}
      </div>
      {detailOpen ? (
        <DocumentRowDetailOverlay
          createdAt={reading.createdAt}
          createdBy={createdBy}
          currentAuthorId={currentAuthorId}
          fields={detailFields}
          onClose={() => setDetailOpen(false)}
          title={`Reading ${index + 1}`}
          updatedAt={reading.updatedAt}
          updatedBy={updatedBy}
        />
      ) : null}
    </>
  );
}
