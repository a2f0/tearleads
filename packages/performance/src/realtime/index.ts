import type { PassMeasurement } from "./measurePass";
import { parseRealtimeOptions, realtimeUsage } from "./options";
import { runRealtimeProbe } from "./probeRun";
import { measureSizes } from "./run";
import { formatMeasurement, summarize } from "./summary";

async function main(): Promise<void> {
  const options = parseRealtimeOptions(process.argv.slice(2));
  if (!options) {
    console.log(realtimeUsage);
    return;
  }
  const measurements: PassMeasurement[] = [];
  await runRealtimeProbe({
    scenario: "realtime-container-interest",
    reportPrefix: "realtime",
    options,
    results: () => ({ summary: summarize(measurements), measurements }),
    measure: (context) =>
      measureSizes({
        ...context,
        options,
        measured: async (measurement) => {
          measurements.push(measurement);
          console.log(formatMeasurement(measurement));
          await context.progress();
        },
      }),
  });
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
