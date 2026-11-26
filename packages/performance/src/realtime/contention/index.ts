import { runRealtimeProbe } from "../probeRun";
import {
  type ContentionMeasurement,
  measureContention,
} from "./measureContention";
import { contentionUsage, parseContentionOptions } from "./options";
import { formatContention, summarizeContention } from "./summary";

async function main(): Promise<void> {
  const options = parseContentionOptions(process.argv.slice(2));
  if (!options) {
    console.log(contentionUsage);
    return;
  }
  // Without this secret the API keys verification markers to this process,
  // so markers earlier runs stored never match and the first pass verifies
  // every manifest in full. Unset, that pass is the same in every run.
  Reflect.deleteProperty(process.env, "DOCUMENT_SYNC_CURSOR_HMAC_KEY");
  if (!options.reuse)
    console.log(
      "Seeding marks every folder as it is written, so there is no unmarked pass; rerun with --reuse to measure one.",
    );
  const measurements: ContentionMeasurement[] = [];
  await runRealtimeProbe({
    scenario: "realtime-hub-contention",
    reportPrefix: "realtime-contention",
    options,
    results: () => ({
      summary: summarizeContention(measurements),
      measurements,
    }),
    measure: (context) =>
      measureContention({
        ...context,
        options,
        measured: async (measurement) => {
          measurements.push(measurement);
          console.log(formatContention(measurement));
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
