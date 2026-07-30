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
import {
  compareTrackerNumbers,
  TRACKER_ABSENT_VALUE,
} from "../shared/trackerValues";
import {
  formatWeight,
  formatWeightChange,
  getWeightChange,
  toWeightEntryDetailFields,
  type WeightEntryRow,
} from "./weightEntries";

/**
 * A weight entry as the index table sees it. The change is resolved up front,
 * against the entry's predecessor in *document* order, so re-sorting the table
 * never restates a delta against a neighbour it was not measured from.
 */
type WeightIndexRow = TrackerIndexRow<WeightEntryRow> & {
  change: string | null;
  changeValue: number | null;
};

/** A row whose change is not comparable sorts after every row whose change is. */
function toSortableChange(change: number | null): number {
  return change ?? Number.POSITIVE_INFINITY;
}

function getWeightColumns(context: {
  currentAuthorId: string | null;
  resolveRowWriter?: RowWriterResolver | undefined;
}): ReadonlyArray<TrackerReadColumn<WeightIndexRow>> {
  return [
    trackerOrdinalColumn<WeightEntryRow>("Entry order"),
    {
      cell: (row) => ({
        absent: row.entry.weight.trim().length === 0,
        text: formatWeight(row.entry),
      }),
      // Entries recorded in different units are not converted, here or anywhere
      // else in this document type, so this orders the figures as logged.
      compare: (left, right) =>
        compareTrackerNumbers(left.entry.weight, right.entry.weight),
      fold: "primary",
      header: "Weight",
      id: "weight",
      monospace: true,
      width: "8rem",
    },
    {
      cell: (row) => ({
        absent: row.change === null,
        text: row.change ?? TRACKER_ABSENT_VALUE,
      }),
      compare: (left, right) =>
        toSortableChange(left.changeValue) -
        toSortableChange(right.changeValue),
      fold: "secondary",
      header: "Change",
      hideable: true,
      id: "change",
      monospace: true,
      width: "7rem",
    },
    trackerMeasuredAtColumn<WeightEntryRow>(),
    trackerNotesColumn<WeightEntryRow>(),
    trackerUpdatedColumn<WeightEntryRow>(context),
  ];
}

/**
 * The weight tracker's index view: every entry as one row of a single sortable
 * table.
 *
 * The drill-down overlay is rendered beside the table rather than inside a row,
 * because the table frame is a scroll container *and* a containing block — an
 * absolutely positioned backdrop mounted inside it would be clipped to the frame
 * and scroll away with the rows.
 */
export function WeightReadTable(params: {
  currentAuthorId: string | null;
  entries: ReadonlyArray<WeightEntryRow>;
  onEnterEdit?: (() => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const { currentAuthorId, entries, onEnterEdit, resolveRowWriter } = params;
  const [detailRowId, setDetailRowId] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      entries.map((entry, index) => ({
        change: formatWeightChange(entry, entries[index - 1]),
        changeValue: getWeightChange(entry, entries[index - 1]),
        entry,
        index,
      })),
    [entries],
  );
  const columns = useMemo(
    () => getWeightColumns({ currentAuthorId, resolveRowWriter }),
    [currentAuthorId, resolveRowWriter],
  );
  const detailRow = rows.find((row) => row.entry.id === detailRowId) ?? null;

  return (
    <>
      <TrackerReadTable
        actionsLabel="Actions"
        ariaLabel="Entries"
        columns={columns}
        columnStorageKey="tearleads.weight.entries:hidden-columns"
        defaultSortColumnId="ordinal"
        emptyLabel="No entries"
        renderActions={(row) => (
          <TrackerReadActions
            actionsAriaLabel={`Entry ${row.index + 1} actions`}
            detailLabel="Attribution"
            detailsOpen={detailRowId === row.entry.id}
            directAriaLabel={`Entry ${row.index + 1} attribution`}
            onEnterEdit={onEnterEdit}
            onOpenDetails={() => setDetailRowId(row.entry.id)}
          />
        )}
        rowKey={(row) => row.entry.id}
        rows={rows}
        sortMenuLabel="Sort entries"
      />
      {detailRow ? (
        <DocumentRowDetailOverlay
          createdAt={detailRow.entry.createdAt}
          createdBy={
            resolveRowWriter?.(detailRow.entry.createdByPeer) ??
            detailRow.entry.createdBy
          }
          currentAuthorId={currentAuthorId}
          fields={toWeightEntryDetailFields(detailRow.entry, resolveRowWriter)}
          onClose={() => setDetailRowId(null)}
          showFieldValues={false}
          title={`Entry ${detailRow.index + 1}`}
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
