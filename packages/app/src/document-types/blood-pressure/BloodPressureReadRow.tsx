import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { TrackerReadCard } from "../shared/TrackerReadCard";
import {
  type BloodPressureReadingRow,
  formatMeasuredAt,
  formatMeasurementPair,
  formatPulse,
  toBloodPressureReadingDetailFields,
} from "./bloodPressureReadings";

export function BloodPressureReadingReadRow(params: {
  currentAuthorId: string | null;
  index: number;
  onEnterEdit?: (() => void) | undefined;
  reading: BloodPressureReadingRow;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const { currentAuthorId, index, onEnterEdit, reading, resolveRowWriter } =
    params;

  return (
    <TrackerReadCard
      actionsAriaLabel={`Reading ${index + 1} actions`}
      cells={[
        { label: "Reading", text: formatMeasurementPair(reading) },
        { label: "Pulse", text: formatPulse(reading) },
        { label: "Measured", text: formatMeasuredAt(reading) },
      ]}
      currentAuthorId={currentAuthorId}
      detailFields={toBloodPressureReadingDetailFields(
        reading,
        resolveRowWriter,
      )}
      detailLabel="Attribution"
      detailTitle={`Reading ${index + 1}`}
      directAriaLabel={`Reading ${index + 1} attribution`}
      index={index}
      notes={reading.notes}
      onEnterEdit={onEnterEdit}
      resolveRowWriter={resolveRowWriter}
      row={reading}
      showFieldValues={false}
    />
  );
}
