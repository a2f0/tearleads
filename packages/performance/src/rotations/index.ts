import { startHttpCounterProxy } from "../inProcess/httpCounterProxy";
import { runInProcessProbe } from "../inProcessProbe";
import { saveReportFile } from "../reportFiles";
import { measureRotations } from "./measureRotations";
import { parseRotationOptions, rotationUsage } from "./options";
import type { RotationPhaseMeasurement } from "./runTier";
import {
  formatRotationLine,
  formatRotationsMarkdown,
  summarizeRotations,
} from "./summary";

async function main(): Promise<void> {
  const options = parseRotationOptions(process.argv.slice(2));
  if (!options) {
    console.log(rotationUsage);
    return;
  }
  const measurements: RotationPhaseMeasurement[] = [];
  let markdownIntro = "";
  let savedRunId = "";
  await runInProcessProbe({
    scenario: "key-rotations",
    reportPrefix: "rotations",
    options,
    boundary:
      "Multi-user Tearleads SDK installs (in-memory SQLite) over a loopback HTTP wire-counting proxy against the in-process API on local PostgreSQL through a wire-counting proxy; no realtime hints, not workerd or Hyperdrive",
    run: async ({ api, database, runId, traffic, progress }) => {
      const httpProxy = startHttpCounterProxy(api.origin);
      savedRunId = runId;
      markdownIntro = `Database \`${database}\`, rotations \`${options.rotations.join(",")}\`, depth \`${options.depth}\`, samples \`${options.samples}\`.`;
      try {
        await measureRotations({
          apiBaseUrl: httpProxy.origin,
          trustOrigin: api.origin,
          options,
          http: httpProxy.snapshot,
          traffic,
          measured: async (measurement) => {
            measurements.push(measurement);
            console.log(formatRotationLine(measurement));
            await progress();
          },
        });
      } finally {
        await httpProxy.stop();
      }
    },
    results: () => ({
      summary: summarizeRotations(measurements),
      measurements,
    }),
  });
  const markdown = formatRotationsMarkdown(
    summarizeRotations(measurements),
    markdownIntro,
  );
  const mdPath = await saveReportFile(
    `rotations-${savedRunId || Date.now()}.md`,
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
