import { createReportWriter } from "./artifacts";
import { parseOptions, targets, usage } from "./options";
import type { Sample } from "./provision";
import { sampleSummary } from "./report";
import { runExperiment, withInterruptionSignal } from "./runner";

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    console.log(usage);
    return;
  }
  const target = targets[options.environment];
  const runId = crypto.randomUUID();
  const samples: Sample[] = [];
  const writer = await createReportWriter(options, runId, samples);
  console.log(
    `Target: ${options.environment} (${target.origin}); ${options.samples} fresh account(s), serial.\nReport: ${writer.path}`,
  );
  const completed = await withInterruptionSignal((signal) =>
    runExperiment({
      options,
      runId,
      samples,
      signal,
      save: writer.save,
      onSample: (sample, tail) =>
        console.log(sampleSummary(sample, tail?.events ?? [])),
    }),
  );
  if (!completed) process.exitCode = 1;
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    // Setup errors originate here; API/SDK exceptions are omitted by provision.
    console.error(
      error instanceof Error ? error.message : "Experiment setup failed.",
    );
    process.exitCode = 1;
  }
}
