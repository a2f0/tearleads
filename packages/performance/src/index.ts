import { createReportWriter } from "./artifacts";
import { openCloudflareTail } from "./cloudflare";
import { parseOptions, targets, usage } from "./options";
import { provision, type Sample } from "./provision";
import { sampleSummary } from "./report";

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
  let tail: Awaited<ReturnType<typeof openCloudflareTail>> | undefined;
  const interrupted = new AbortController();
  const stop = () => interrupted.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(
    `Target: ${options.environment} (${target.origin}); ${options.samples} fresh account(s), serial.\nReport: ${writer.path}`,
  );
  try {
    await writer.save("running", tail);
    if (options.cloudflare)
      tail = await openCloudflareTail(target.worker, runId);
    for (let index = 1; index <= options.samples; index += 1) {
      if (interrupted.signal.aborted) break;
      const sample = await provision({
        origin: target.origin,
        runId,
        index,
        signal: AbortSignal.any([
          interrupted.signal,
          AbortSignal.timeout(60_000),
        ]),
      });
      samples.push(sample);
      await writer.save("running", tail);
      console.log(sampleSummary(sample, tail?.events ?? []));
      if (sample.status === "failed") break;
      if (index < options.samples) await Bun.sleep(1_000);
    }
    // Invocation logs can arrive after the response and after waitUntil work.
    if (tail) {
      const deadline = performance.now() + 10_000;
      while (
        performance.now() < deadline &&
        !interrupted.signal.aborted &&
        samples.some((sample) =>
          sample.requests.some(
            (request) =>
              !tail?.events.some((event) => event.requestId === request.id),
          ),
        )
      )
        await Bun.sleep(100);
    }
  } finally {
    await tail?.close();
    const failed =
      interrupted.signal.aborted ||
      samples.length !== options.samples ||
      samples.some((sample) => sample.status !== "passed");
    await writer.save(failed ? "failed" : "complete", tail);
    if (failed) process.exitCode = 1;
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
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
