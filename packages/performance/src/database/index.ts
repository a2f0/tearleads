import { parseOptions } from "../options";
import { withInterruptionSignal } from "../runner";
import { runDatabaseExperiment } from "./run";

const usage = `Read-only database latency experiment.
bun run perf:database --env staging|production [--samples 1..10] [--cloudflare]

Creates an authenticated, expiring Worker on the API's existing Hyperdrive
binding and placement. Runs constant queries; no user data is read or written.
Deletes the Worker and confirms deletion afterward. --cloudflare captures CPU via tail. Cloudflare credentials
require Workers Scripts Edit and Hyperdrive Read. Reports retain no credentials.`;

try {
  const options = parseOptions(process.argv.slice(2));
  if (!options) console.info(usage);
  else
    await withInterruptionSignal((signal) =>
      runDatabaseExperiment(options, signal),
    );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Database experiment failed.",
  );
  process.exitCode = 1;
}
