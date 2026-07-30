import { useMemo, useState } from "react";
import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { DocumentRowDetailOverlay } from "../shared/DocumentRowDetail";
import { TrackerReadActions } from "../shared/TrackerReadActions";
import {
  type TrackerReadColumn,
  TrackerReadTable,
} from "../shared/TrackerReadTable";
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
  onEnterEdit?: (() => void) | undefined;
  readings: ReadonlyArray<BloodPressureReadingRow>;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const { currentAuthorId, onEnterEdit, readings, resolveRowWriter } = params;
  const [detailRowId, setDetailRowId] = useState<string | null>(null);
  const rows = useMemo(
    () => readings.map((entry, index) => ({ entry, index })),
    [readings],
  );
  const columns = useMemo(
    () => getBloodPressureColumns({ currentAuthorId, resolveRowWriter }),
    [currentAuthorId, resolveRowWriter],
  );
  const detailRow = rows.find((row) => row.entry.id === detailRowId) ?? null;

  return (
    <>
      <TrackerReadTable
        actionsLabel="Actions"
        ariaLabel="Readings"
        columns={columns}
        columnStorageKey="tearleads.blood-pressure.readings:hidden-columns:v2"
        defaultSortColumnId="ordinal"
        emptyLabel="No readings"
        renderActions={(row) => (
          <TrackerReadActions
            actionsAriaLabel={`Reading ${row.index + 1} actions`}
            detailLabel="Attribution"
            detailsOpen={detailRowId === row.entry.id}
            directAriaLabel={`Reading ${row.index + 1} attribution`}
            onEnterEdit={onEnterEdit}
            onOpenDetails={() => setDetailRowId(row.entry.id)}
          />
        )}
        rowKey={(row) => row.entry.id}
        rows={rows}
        sortMenuLabel="Sort readings"
      />
      {detailRow ? (
        <DocumentRowDetailOverlay
          createdAt={detailRow.entry.createdAt}
          createdBy={
            resolveRowWriter?.(detailRow.entry.createdByPeer) ??
            detailRow.entry.createdBy
          }
          currentAuthorId={currentAuthorId}
          fields={toBloodPressureReadingDetailFields(
            detailRow.entry,
            resolveRowWriter,
          )}
          onClose={() => setDetailRowId(null)}
          showFieldValues={false}
          title={`Reading ${detailRow.index + 1}`}
          updatedAt={detailRow.entry.updatedAt}
          updatedBy={
            resolveRowWriter?.(detailRow.entry.updatedByPeer) ??
            detailRow.entry.updatedBy
          }
        />
      ) : null}
    </>
  );
}
