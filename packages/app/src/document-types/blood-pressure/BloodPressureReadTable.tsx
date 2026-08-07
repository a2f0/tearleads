import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { TrackerIndexTable } from "../shared/TrackerIndexTable";
import type { TrackerReadColumn } from "../shared/TrackerReadTable";
import {
  type TrackerIndexRow,
  trackerMeasuredAtColumn,
  trackerNotesColumn,
  trackerOrdinalColumn,
  trackerUpdatedColumn,
} from "../shared/trackerIndexColumns";
import { compareTrackerNumbers } from "../shared/trackerValues";
import { isValidBloodPressureMeasurement } from "./bloodPressureDocumentDefinition";
import {
  type BloodPressureReadingRow,
  formatMeasurementPair,
  formatPulse,
  toBloodPressureReadingDetailFields,
} from "./bloodPressureReadings";

type BloodPressureIndexRow = TrackerIndexRow<BloodPressureReadingRow>;

function buildBloodPressureRows(
  readings: ReadonlyArray<BloodPressureReadingRow>,
): BloodPressureIndexRow[] {
  return readings.map((entry, index) => ({ entry, index }));
}

function getBloodPressureColumns(context: {
  currentAuthorId: string | null;
  resolveRowWriter?: RowWriterResolver | undefined;
}): ReadonlyArray<TrackerReadColumn<BloodPressureIndexRow>> {
  return [
    trackerOrdinalColumn<BloodPressureReadingRow>("Reading order"),
    {
      cell: (row) => ({
        text: formatMeasurementPair(row.entry),
        // The column ranks the pair, and diastolic settles ties between readings
        // that share a systolic — so a half-recorded reading has no place among
        // the ordered ones in either direction, not just a missing systolic.
        unranked:
          !isValidBloodPressureMeasurement(row.entry.systolic) ||
          !isValidBloodPressureMeasurement(row.entry.diastolic),
      }),
      // Systolic is the figure a reading is read by; diastolic only settles ties
      // between two readings that share it.
      compare: (left, right) =>
        compareTrackerNumbers(left.entry.systolic, right.entry.systolic) ||
        compareTrackerNumbers(left.entry.diastolic, right.entry.diastolic),
      fold: "primary",
      header: "Reading",
      id: "reading",
      monospace: true,
      width: "9rem",
    },
    {
      cell: (row) => ({
        text: formatPulse(row.entry),
        unranked: !isValidBloodPressureMeasurement(row.entry.pulse),
      }),
      compare: (left, right) =>
        compareTrackerNumbers(left.entry.pulse, right.entry.pulse),
      fold: "secondary",
      header: "Pulse",
      hideable: true,
      id: "pulse",
      monospace: true,
      width: "6rem",
    },
    trackerMeasuredAtColumn<BloodPressureReadingRow>(),
    trackerNotesColumn<BloodPressureReadingRow>(),
    trackerUpdatedColumn<BloodPressureReadingRow>(context),
  ];
}

/**
 * The blood pressure tracker's index view: every reading as one row of a single
 * sortable table.
 *
 * The drill-down overlay is rendered here rather than inside a row, because the
 * table frame is a scroll container *and* a containing block — an absolutely
 * positioned backdrop mounted inside it would be clipped to the frame and scroll
 * away with the rows.
 */
export function BloodPressureReadTable(params: {
  currentAuthorId: string | null;
  onEnterEdit?: ((id: string) => void) | undefined;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const { currentAuthorId, onEnterEdit, readings, resolveRowWriter } = params;

  return (
    <TrackerIndexTable
      actionsAriaLabel={(row) => `Reading ${row.index + 1} actions`}
      ariaLabel="Readings"
      buildRows={buildBloodPressureRows}
      columnStorageKey="tearleads.blood-pressure.readings:hidden-columns:v2"
      currentAuthorId={currentAuthorId}
      detailFields={toBloodPressureReadingDetailFields}
      detailLabel="Attribution"
      detailTitle={(row) => `Reading ${row.index + 1}`}
      directAriaLabel={(row) => `Reading ${row.index + 1} attribution`}
      emptyLabel="No readings"
      entries={readings}
      getColumns={getBloodPressureColumns}
      onEnterEdit={onEnterEdit}
      resolveRowWriter={resolveRowWriter}
      showFieldValues={false}
      sortMenuLabel="Sort readings"
    />
  );
}
