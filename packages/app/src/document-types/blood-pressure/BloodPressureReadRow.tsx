import { useState } from "react";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import {
  DocumentRowDetailOverlay,
  type RowDetailField,
} from "../shared/DocumentRowDetail";
import { formatRowAttribution } from "../shared/rowAttribution";
import { TrackerReadActions } from "../shared/TrackerReadActions";
import "../shared/TrackerFormControls.css";
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

// Build the per-field attribution rows for the drill-down. Each cell's verified
// writer is resolved from its last-editor peer; null when unknown (attribution
// not synced) so the overlay can omit it.
function toReadingDetailFields(
  reading: BloodPressureReadingRow,
  resolveRowWriter?: RowWriterResolver | undefined,
): RowDetailField[] {
  const fieldWriter = (field: string): string | null =>
    resolveRowWriter?.(reading.fieldEditors[field] ?? null) ?? null;
  return [
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
}

// A single reading in read mode: the summary cells, a kebab that opens a small
// actions menu (Edit / Attribution), and the row's last-edit attribution line.
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
  const detailFields = toReadingDetailFields(reading, resolveRowWriter);

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
