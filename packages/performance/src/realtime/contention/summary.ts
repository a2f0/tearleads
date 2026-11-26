import type { ContentionMeasurement } from "./measureContention";

const mebibytes = (bytes: number) => (bytes / 1_048_576).toFixed(1);

/** One terminal row per measured pass. */
export function formatContention(measurement: ContentionMeasurement): string {
  const { hints, resources } = measurement;
  const subject =
    measurement.pass === "idle"
      ? "idle hub"
      : `${measurement.sockets} × ${measurement.size} folders`;
  return [
    subject,
    `${measurement.pass} #${measurement.sample}`,
    `${measurement.durationMs} ms`,
    `hint lag p50 ${hints.p50Ms} ms, p99 ${hints.p99Ms} ms, max ${hints.maxMs} ms`,
    `${hints.delivered}/${hints.sent} hints`,
    `${resources.cpuMs} ms CPU`,
    `${mebibytes(resources.peakHeapDeltaBytes)} MiB peak heap`,
  ].join(", ");
}

interface ContentionSummary {
  readonly pass: ContentionMeasurement["pass"];
  readonly size: number;
  readonly sockets: number;
  readonly samples: number;
  readonly medianDurationMs: number;
  /** The slowest socket's authorization, median across samples. */
  readonly medianSlowestAuthorizationMs: number;
  readonly medianHintP50Ms: number;
  readonly medianHintP99Ms: number;
  readonly maxHintLagMs: number;
  readonly medianBlockedMs: number;
  readonly medianCpuMs: number;
  readonly maxPeakHeapDeltaBytes: number;
  readonly bytesReturned: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Medians per pass, size and socket count; maxima for the worst stall. */
export function summarizeContention(
  measurements: readonly ContentionMeasurement[],
): ContentionSummary[] {
  const groups = new Map<string, ContentionMeasurement[]>();
  for (const measurement of measurements) {
    const key = `${measurement.pass}:${measurement.size}:${measurement.sockets}`;
    groups.set(key, [...(groups.get(key) ?? []), measurement]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    if (!first) throw new Error("Empty measurement group.");
    const middle = (pick: (m: ContentionMeasurement) => number) =>
      median(group.map(pick));
    const most = (pick: (m: ContentionMeasurement) => number) =>
      Math.max(...group.map(pick));
    return {
      pass: first.pass,
      size: first.size,
      sockets: first.sockets,
      samples: group.length,
      medianDurationMs: middle((m) => m.durationMs),
      medianSlowestAuthorizationMs: middle(
        (m) => m.authorizationMs.at(-1) ?? 0,
      ),
      medianHintP50Ms: middle((m) => m.hints.p50Ms),
      medianHintP99Ms: middle((m) => m.hints.p99Ms),
      maxHintLagMs: most((m) => m.hints.maxMs),
      medianBlockedMs: middle((m) => m.hints.blockedMs),
      medianCpuMs: middle((m) => m.resources.cpuMs),
      maxPeakHeapDeltaBytes: most((m) => m.resources.peakHeapDeltaBytes),
      bytesReturned: most((m) => m.database.bytesReturned),
    };
  });
}
