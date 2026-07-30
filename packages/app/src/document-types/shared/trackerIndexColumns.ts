import type { RowWriterResolver } from "../../stores/documents/useDocumentRowWriters";
import { formatRowByline } from "./rowAttribution";
import type { TrackerReadColumn } from "./TrackerReadTable";
import {
  compareTrackerText,
  formatTrackerMeasuredAt,
  TRACKER_ABSENT_VALUE,
} from "./trackerValues";

/** The attribution every tracker row model carries, whatever it measures. */
interface TrackerIndexEntry {
  createdAt: string;
  createdBy: string;
  createdByPeer: string | null;
  updatedAt: string;
  updatedBy: string;
  updatedByPeer: string | null;
}

/**
 * One entry as its index table sees it: the stored row plus the ordinal its
 * controls are named by ("Reading 3 actions"). The ordinal is fixed to document
 * order, so re-sorting the table for display never renumbers an entry.
 */
export interface TrackerIndexRow<TEntry extends TrackerIndexEntry> {
  entry: TEntry;
  index: number;
}

/**
 * The entry's position in the document, and the table's default sort: ascending
 * is document order, so the table opens in the order entries were logged.
 *
 * Off by default. The number is a *position*, not an identity — it renumbers
 * when an earlier entry is removed, and a tracker synced from two peers orders by
 * how the merge interleaved the rows rather than by when anything was measured —
 * so it earns its place in the columns menu rather than in the opening view. The
 * default sort still refers to it, which with the column switched off is simply
 * the list's own order. A wide table shows that as no sort at all — no header
 * carries an indicator until the reader picks a column. A folded one has a single
 * select menu that must always name its active key, so there it reads as "Entry
 * order", which is what the rows are in either way.
 */
export function trackerOrdinalColumn<TEntry extends TrackerIndexEntry>(
  sortLabel: string,
): TrackerReadColumn<TrackerIndexRow<TEntry>> {
  return {
    cell: (row) => ({ text: `${row.index + 1}` }),
    className: "tracker-read-table-ordinal",
    compare: (left, right) => left.index - right.index,
    defaultHidden: true,
    fold: "none",
    header: "#",
    hideable: true,
    id: "ordinal",
    sortLabel,
    width: "3.5rem",
  };
}

/** When a dated tracker entry says it was measured. */
export function trackerMeasuredAtColumn<
  TEntry extends TrackerIndexEntry & { measuredAt: string },
>(): TrackerReadColumn<TrackerIndexRow<TEntry>> {
  return {
    cell: (row) => ({
      unranked: row.entry.measuredAt.trim().length === 0,
      text: formatTrackerMeasuredAt(row.entry.measuredAt),
    }),
    compare: (left, right) =>
      compareTrackerText(left.entry.measuredAt, right.entry.measuredAt),
    fold: "primary",
    header: "Measured",
    id: "measured",
    monospace: true,
    width: "10rem",
  };
}

/**
 * The free-text note a dated tracker entry may carry.
 *
 * Carries no `width` and is not hideable, deliberately: it is the column that
 * absorbs whatever the measured ones leave, and a table where every column is
 * measured overflows its frame rather than shrinking (see
 * TrackerReadColumn.hideable).
 */
export function trackerNotesColumn<
  TEntry extends TrackerIndexEntry & { notes: string },
>(): TrackerReadColumn<TrackerIndexRow<TEntry>> {
  return {
    cell: (row) => {
      const notes = row.entry.notes.trim();
      return {
        unranked: notes.length === 0,
        text: notes.length > 0 ? notes : TRACKER_ABSENT_VALUE,
        ...(notes.length > 0 ? { title: notes } : {}),
      };
    },
    compare: (left, right) =>
      compareTrackerText(left.entry.notes, right.entry.notes),
    fold: "secondary",
    header: "Notes",
    id: "notes",
    muted: true,
  };
}

/**
 * Who last edited the entry, and when — the byline the entry cards carried on
 * their own line, as a column the table can order by.
 *
 * Prefers the server-verified writer of the row's last edit, falling back to its
 * self-attested author when attribution has not synced.
 *
 * The widest column and the one readers scan least, so it starts switched off and
 * sits out the two-line phone fold entirely — squeezed onto a phone line it
 * truncated every field beside it. The columns menu turns it on for a wide pane,
 * and the row's kebab reaches the same attribution either way.
 */
export function trackerUpdatedColumn<
  TEntry extends TrackerIndexEntry,
>(context: {
  currentAuthorId: string | null;
  resolveRowWriter?: RowWriterResolver | undefined;
}): TrackerReadColumn<TrackerIndexRow<TEntry>> {
  return {
    cell: (row) => {
      const byline = formatRowByline({
        at: row.entry.updatedAt,
        by:
          context.resolveRowWriter?.(row.entry.updatedByPeer) ??
          row.entry.updatedBy,
        currentAuthorId: context.currentAuthorId,
      });
      return {
        unranked: byline === null,
        text: byline ?? TRACKER_ABSENT_VALUE,
        ...(byline === null ? {} : { title: byline }),
      };
    },
    compare: (left, right) =>
      compareTrackerText(left.entry.updatedAt, right.entry.updatedAt),
    defaultHidden: true,
    fold: "none",
    header: "Updated",
    hideable: true,
    id: "updated",
    monospace: true,
    muted: true,
    width: "12rem",
  };
}
