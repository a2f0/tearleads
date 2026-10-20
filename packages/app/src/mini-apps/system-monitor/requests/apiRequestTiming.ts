import type {
  ApiRequestEndpointCounts,
  ApiRequestMetricsSnapshot,
} from "@tearleads/client-sdk";

type DurationSummary = ApiRequestEndpointCounts["duration"];

export const apiRequestTimingHeaders = [
  "Endpoint",
  "Total ms",
  "p50 ms",
  "p95 ms",
  "Max ms",
  "Server p50 ms",
  "DB p50 ms",
] as const;

export const apiRequestTimingDescription =
  "Each attempt is timed from dispatch until its response headers arrive or it fails, so body downloads are excluded. p50 and p95 cover each endpoint's latest 256 attempts; total and max cover every attempt since reset. Server and DB columns come from the API's Server-Timing header and stay blank when it is absent; on the Workers runtime they measure I/O wait, not CPU time.";

export interface ApiRequestTimingRow {
  readonly endpoint: string;
  /** Values for every header after Endpoint, blank when unreported. */
  readonly cells: readonly string[];
}

export function formatDurationMs(ms: number): string {
  return ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
}

function formatP50(summary: DurationSummary): string {
  return summary ? formatDurationMs(summary.p50Ms) : "";
}

/** Timed endpoints, the largest cumulative time first. */
export function listApiRequestTimingRows(
  snapshot: ApiRequestMetricsSnapshot,
): ApiRequestTimingRow[] {
  return snapshot.endpoints
    .flatMap((row) => (row.duration ? [{ row, duration: row.duration }] : []))
    .sort(
      (left, right) =>
        right.duration.totalMs - left.duration.totalMs ||
        `${left.row.method} ${left.row.path}`.localeCompare(
          `${right.row.method} ${right.row.path}`,
          "en",
        ),
    )
    .map(({ row, duration }) => ({
      endpoint: `${row.method} ${row.path}`,
      cells: [
        formatDurationMs(duration.totalMs),
        formatDurationMs(duration.p50Ms),
        formatDurationMs(duration.p95Ms),
        formatDurationMs(duration.maxMs),
        formatP50(row.serverDuration),
        formatP50(row.databaseDuration),
      ],
    }));
}
