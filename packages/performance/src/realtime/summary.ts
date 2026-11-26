import { median } from "../median";
import type { PassMeasurement } from "./measurePass";

const mebibytes = (bytes: number) => (bytes / 1_048_576).toFixed(1);

/** One terminal row per measured pass. */
export function formatMeasurement(measurement: PassMeasurement): string {
  const { database, resources } = measurement;
  const columns = [
    `${measurement.size} folders`,
    `${measurement.pass} #${measurement.sample}`,
    `${measurement.durationMs} ms`,
    `${database.statements} statements`,
    `${database.roundTrips} round trips`,
    `${database.rows} rows`,
    `${mebibytes(database.bytesReturned)} MiB returned`,
    `${resources.cpuMs} ms CPU`,
    `${mebibytes(resources.peakHeapDeltaBytes)} MiB peak heap`,
  ];
  if (measurement.durationMs > measurement.productionBudgetMs)
    columns.push(`over the ${measurement.productionBudgetMs / 1000} s budget`);
  return columns.join(", ");
}

interface SizeSummary {
  readonly size: number;
  readonly pass: PassMeasurement["pass"];
  readonly samples: number;
  readonly medianDurationMs: number;
  readonly medianCpuMs: number;
  readonly statements: number;
  readonly roundTrips: number;
  readonly rows: number;
  readonly bytesReturned: number;
  readonly maxPeakHeapDeltaBytes: number;
  readonly productionBudgetMs: number;
}

/**
 * Medians per size and pass. Database counts are the largest sample's, since
 * every sample issues the same work; inspect samples when they differ.
 */
export function summarize(
  measurements: readonly PassMeasurement[],
): SizeSummary[] {
  const groups = new Map<string, PassMeasurement[]>();
  for (const measurement of measurements) {
    const key = `${measurement.size}:${measurement.pass}`;
    groups.set(key, [...(groups.get(key) ?? []), measurement]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    if (!first) throw new Error("Empty measurement group.");
    const most = (pick: (m: PassMeasurement) => number) =>
      Math.max(...group.map(pick));
    return {
      size: first.size,
      pass: first.pass,
      samples: group.length,
      medianDurationMs: median(group.map((m) => m.durationMs)),
      medianCpuMs: median(group.map((m) => m.resources.cpuMs)),
      statements: most((m) => m.database.statements),
      roundTrips: most((m) => m.database.roundTrips),
      rows: most((m) => m.database.rows),
      bytesReturned: most((m) => m.database.bytesReturned),
      maxPeakHeapDeltaBytes: most((m) => m.resources.peakHeapDeltaBytes),
      productionBudgetMs: first.productionBudgetMs,
    };
  });
}
