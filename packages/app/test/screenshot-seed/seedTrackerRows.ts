import { trackerGraphTimestamp } from "../../src/document-types/shared/timeSeriesGraphData";

/** Continuity records an offset; tracker inputs store the recorded wall clock. */
export function seedTrackerRow(
  row: Readonly<Record<string, string>>,
): Record<string, string> {
  const { measuredAt: source = "" } = row;
  const measuredAt = source.replace(/(?:Z|[+-]\d{2}:\d{2})$/u, "");
  if (
    !Number.isFinite(trackerGraphTimestamp(measuredAt)) ||
    (source !== measuredAt && !Number.isFinite(Date.parse(source)))
  ) {
    throw new Error(`Invalid seed tracker measurement time: ${source}`);
  }
  return { ...row, measuredAt };
}
