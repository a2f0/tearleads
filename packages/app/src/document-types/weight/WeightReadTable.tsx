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
import { TRACKER_ABSENT_VALUE } from "../shared/trackerValues";
import {
  formatWeight,
  formatWeightChange,
  getWeightChange,
  toComparableWeight,
  toComparableWeightChange,
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

/**
 * Ascending order over two comparable magnitudes. A row with no magnitude at all
 * (an unset or half-typed weight, a change across units) reads as NaN, which no
 * comparison can order. Those rows declare themselves `unranked` and the table
 * pins them below the rest in both directions, so this only has to stay total
 * rather than place them itself — placing them here is what would let a reversed
 * header lift them to the top.
 */
function compareWeightMagnitudes(left: number, right: number): number {
  if (Number.isNaN(left) || Number.isNaN(right)) {
    return 0;
  }

  return left - right;
}

function getWeightColumns(context: {
  currentAuthorId: string | null;
  resolveRowWriter?: RowWriterResolver | undefined;
}): ReadonlyArray<TrackerReadColumn<WeightIndexRow>> {
  return [
    trackerOrdinalColumn<WeightEntryRow>("Entry order"),
    {
      cell: (row) => ({
        text: formatWeight(row.entry),
        // A weight the document would reject has no magnitude to be ranked by,
        // so it sits below the real ones however the column is turned.
        unranked: Number.isNaN(
          toComparableWeight(row.entry.weight, row.entry.unit),
        ),
      }),
      // Compared as magnitudes, not as the bare figures: a tracker holding both
      // units would otherwise file 90 kg below 180 lb. Nothing converted here
      // reaches the screen — the cell above still reads what was recorded.
      compare: (left, right) =>
        compareWeightMagnitudes(
          toComparableWeight(left.entry.weight, left.entry.unit),
          toComparableWeight(right.entry.weight, right.entry.unit),
        ),
      fold: "primary",
      header: "Weight",
      id: "weight",
      monospace: true,
      width: "8rem",
    },
    {
      cell: (row) => ({
        text: row.change ?? TRACKER_ABSENT_VALUE,
        unranked: row.change === null,
      }),
      // A change carries its entry's unit too, so +2 kg and +2 lb are no more
      // comparable as raw numbers than the weights they came from.
      compare: (left, right) =>
        compareWeightMagnitudes(
          toComparableWeightChange(left.changeValue, left.entry.unit),
          toComparableWeightChange(right.changeValue, right.entry.unit),
        ),
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

function buildWeightRows(
  entries: ReadonlyArray<WeightEntryRow>,
): WeightIndexRow[] {
  return entries.map((entry, index) => ({
    change: formatWeightChange(entry, entries[index - 1]),
    changeValue: getWeightChange(entry, entries[index - 1]),
    entry,
    index,
  }));
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
  onEnterEdit?: ((id: string) => void) | undefined;
  resolveRowWriter?: RowWriterResolver | undefined;
}) {
  const { currentAuthorId, entries, onEnterEdit, resolveRowWriter } = params;

  return (
    <TrackerIndexTable
      actionsAriaLabel={(row) => `Entry ${row.index + 1} actions`}
      ariaLabel="Entries"
      buildRows={buildWeightRows}
      columnStorageKey="tearleads.weight.entries:hidden-columns:v2"
      currentAuthorId={currentAuthorId}
      detailFields={toWeightEntryDetailFields}
      detailLabel="Attribution"
      detailTitle={(row) => `Entry ${row.index + 1}`}
      directAriaLabel={(row) => `Entry ${row.index + 1} attribution`}
      emptyLabel="No entries"
      entries={entries}
      getColumns={getWeightColumns}
      onEnterEdit={onEnterEdit}
      resolveRowWriter={resolveRowWriter}
      showFieldValues={false}
      sortMenuLabel="Sort entries"
    />
  );
}
