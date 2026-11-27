import { startHttpCounterProxy } from "../inProcess/httpCounterProxy";
import { runInProcessProbe } from "../inProcessProbe";
import { saveReportFile } from "../reportFiles";
import { measureBaselines } from "./measureBaselines";
import { baselineUsage, parseBaselineOptions } from "./options";
import type { BaselinePhaseMeasurement } from "./runTier";
import {
  formatBaselineLine,
  formatBaselinesMarkdown,
  summarizeBaselines,
} from "./summary";

async function main(): Promise<void> {
  const options = parseBaselineOptions(process.argv.slice(2));
  if (!options) {
    console.log(baselineUsage);
    return;
  }
  const measurements: BaselinePhaseMeasurement[] = [];
  let markdownIntro = "";
  let savedRunId = "";
  await runInProcessProbe({
    scenario: "rotation-baselines",
    reportPrefix: "baselines",
    options,
    boundary:
      "Multi-user Tearleads SDK installs (in-memory SQLite) over a loopback HTTP wire-counting proxy against the in-process API on local PostgreSQL through a wire-counting proxy; no realtime hints, not workerd or Hyperdrive",
    run: async ({ api, database, runId, traffic, progress }) => {
      const httpProxy = startHttpCounterProxy(api.origin);
      savedRunId = runId;
      markdownIntro = `Database \`${database}\`, sizes \`${options.sizesMb.join(",")}\` MiB, chunk \`${options.chunkMb}\` MiB, race \`${options.race}\`, samples \`${options.samples}\`.`;
      try {
        await measureBaselines({
          apiBaseUrl: httpProxy.origin,
          trustOrigin: api.origin,
          options,
          http: httpProxy.snapshot,
          traffic,
          holdBeforeRequest: httpProxy.holdBeforeRequest,
          measured: async (measurement) => {
            measurements.push(measurement);
            console.log(formatBaselineLine(measurement));
            await progress();
          },
        });
      } finally {
        await httpProxy.stop();
      }
    },
    results: () => ({
      summary: summarizeBaselines(measurements),
      measurements,
    }),
  });
  const markdown = formatBaselinesMarkdown(
    summarizeBaselines(measurements),
    markdownIntro,
  );
  const mdPath = await saveReportFile(
    `baselines-${savedRunId || Date.now()}.md`,
    markdown,
  );
  console.log(`\n${markdown}Markdown: ${mdPath}`);
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
