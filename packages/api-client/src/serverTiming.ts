export const serverTimingHeaderName = "Server-Timing";

/** The API's own `total` and `db` Server-Timing durations, when reported. */
export interface ApiServerTiming {
  readonly totalMs: number | null;
  readonly databaseMs: number | null;
}

function readDuration(parameters: readonly string[]): number | null {
  for (const parameter of parameters) {
    const separator = parameter.indexOf("=");
    if (separator < 0) continue;
    if (parameter.slice(0, separator).trim().toLowerCase() !== "dur") continue;
    const value = parameter
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
    // Only the first `dur` counts; a malformed one leaves the metric unset.
    if (!/^\d+(\.\d+)?$/.test(value)) return null;
    return Number(value);
  }
  return null;
}

/**
 * Reads `total;dur=<ms>, db;dur=<ms>` in any order. Unknown metrics, missing
 * metrics and malformed durations are ignored; the first entry of a metric
 * wins. Returns null when neither metric is present.
 */
export function parseServerTiming(
  header: string | null,
): ApiServerTiming | null {
  if (header === null) return null;
  let totalMs: number | null = null;
  let databaseMs: number | null = null;
  const seen = new Set<string>();
  for (const entry of header.split(",")) {
    const [name = "", ...parameters] = entry.split(";");
    const metric = name.trim().toLowerCase();
    if (metric !== "total" && metric !== "db") continue;
    if (seen.has(metric)) continue;
    seen.add(metric);
    const duration = readDuration(parameters);
    if (metric === "total") totalMs = duration;
    else databaseMs = duration;
  }
  return totalMs === null && databaseMs === null
    ? null
    : { totalMs, databaseMs };
}
