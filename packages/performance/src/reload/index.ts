import { runInProcessProbe } from "../inProcessProbe";
import { measureReloads, type ReloadMeasurement } from "./measureReload";
import { parseReloadOptions, reloadUsage } from "./options";
import { openReloadAccount } from "./reloadAccount";
import { formatReload, summarizeReloads } from "./summary";

async function main(): Promise<void> {
  const options = parseReloadOptions(process.argv.slice(2));
  if (!options) {
    console.log(reloadUsage);
    return;
  }
  const measurements: ReloadMeasurement[] = [];
  await runInProcessProbe({
    scenario: "document-reload",
    reportPrefix: "reload",
    options,
    boundary:
      "The client SDK on Bun over in-memory SQLite, against the in-process API on local PostgreSQL through a counting proxy; not a browser, workerd or Hyperdrive, and without the app shell's own requests",
    run: async ({ api, traffic, progress }) => {
      console.log("Registering an account through the SDK.");
      const account = await openReloadAccount(api.origin, options.quietMs);
      try {
        await measureReloads({
          account,
          options,
          traffic,
          grown: (documents, durationMs) =>
            console.log(
              `Grew to ${documents} notes in ${(durationMs / 1000).toFixed(1)} s.`,
            ),
          measured: async (measurement) => {
            measurements.push(measurement);
            console.log(formatReload(measurement));
            await progress();
          },
        });
      } finally {
        account.close();
      }
    },
    results: () => ({
      summary: summarizeReloads(measurements),
      measurements,
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
