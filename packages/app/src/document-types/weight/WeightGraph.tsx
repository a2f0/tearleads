import { TimeSeriesGraph } from "../shared/TimeSeriesGraph";
import {
  isValidWeightMeasurement,
  WEIGHT_UNITS,
  type WeightUnit,
} from "./weightDocumentDefinition";
import type { WeightEntryRow } from "./weightEntries";

export function WeightGraph({
  entries,
  unit,
}: {
  entries: ReadonlyArray<WeightEntryRow>;
  unit: WeightUnit;
}) {
  const units =
    entries.length === 0
      ? [unit]
      : WEIGHT_UNITS.filter((candidate) =>
          entries.some((entry) => entry.unit === candidate),
        );
  return units.map((entryUnit) => (
    <TimeSeriesGraph
      key={entryUnit}
      title={`Weight over time (${entryUnit})`}
      unit={entryUnit}
      series={[
        {
          id: "weight",
          label: "Weight",
          points: entries
            .filter(
              (entry) =>
                entry.unit === entryUnit &&
                isValidWeightMeasurement(entry.weight),
            )
            .map((entry) => ({
              id: entry.id,
              measuredAt: entry.measuredAt,
              value: Number(entry.weight),
            })),
        },
      ]}
    />
  ));
}
