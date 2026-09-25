import { TimeSeriesGraph } from "../shared/TimeSeriesGraph";
import { isValidBloodPressureMeasurement } from "./bloodPressureDocumentDefinition";
import type { BloodPressureReadingRow } from "./bloodPressureReadings";

export function BloodPressureGraph({
  readings,
}: {
  readings: ReadonlyArray<BloodPressureReadingRow>;
}) {
  const series = (
    field: "systolic" | "diastolic" | "pulse",
    label: string,
  ) => ({
    id: field,
    label,
    points: readings
      .filter((reading) => isValidBloodPressureMeasurement(reading[field]))
      .map((reading) => ({
        id: reading.id,
        measuredAt: reading.measuredAt,
        value: Number(reading[field]),
      })),
  });
  const pulse = series("pulse", "Pulse");
  return (
    <>
      <TimeSeriesGraph
        title="Blood pressure over time"
        unit="mmHg"
        series={[
          series("systolic", "Systolic"),
          series("diastolic", "Diastolic"),
        ]}
      />
      {pulse.points.length > 0 ? (
        <TimeSeriesGraph title="Pulse over time" unit="bpm" series={[pulse]} />
      ) : null}
    </>
  );
}
