/**
 * Value formatting and ordering shared by the tracker document types (blood
 * pressure, weight, .env). Kept free of React so the row models — plain `.ts`
 * modules — can use it alongside the index tables.
 */

/** What a tracker shows where a cell has no value at all. */
export const TRACKER_EMPTY_VALUE = "None";

/**
 * What an index table shows where a column has nothing to report for a row — an
 * entry with no note, no comparable predecessor, or no synced attribution. Kept
 * distinct from {@link TRACKER_EMPTY_VALUE}, which stands for a measurement the
 * user has not filled in and could.
 */
export const TRACKER_ABSENT_VALUE = "—";

/**
 * A `datetime-local` value ("2026-07-16T08:30") read as a plain timestamp.
 * Swapping the "T" for a space keeps the read view legible without pulling in
 * locale-dependent Date parsing, which would also reinterpret the wall-clock
 * time the user actually typed.
 */
export function formatTrackerMeasuredAt(measuredAt: string): string {
  const trimmed = measuredAt.trim();
  return trimmed.length > 0 ? trimmed.replace("T", " ") : TRACKER_EMPTY_VALUE;
}

/**
 * Ascending order for a stored numeric measurement. A blank or half-typed cell
 * sorts last rather than reading as zero, which would file an empty reading
 * below every real one.
 */
export function compareTrackerNumbers(left: string, right: string): number {
  return toSortableNumber(left) - toSortableNumber(right);
}

/**
 * Ascending order for a stored text cell (a key, a note). Blank sorts last, for
 * the same reason a blank measurement does.
 */
export function compareTrackerText(left: string, right: string): number {
  const first = left.trim();
  const second = right.trim();
  if (first.length === 0 || second.length === 0) {
    return first.length === second.length ? 0 : first.length === 0 ? 1 : -1;
  }

  return first.localeCompare(second);
}

function toSortableNumber(value: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  // `Number`, not `Number.parseFloat`: the latter reads a leading prefix, so a
  // half-typed "180abc" would order as 180 among the real measurements instead of
  // falling to the end with the rest of the values this cannot rank.
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
