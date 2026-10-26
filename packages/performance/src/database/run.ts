import { setTimeout as delay } from "node:timers/promises";
import { openCloudflareTail } from "../cloudflare";
import type { Options } from "../options";
import { runHeader } from "../transport";
import { collectSamples, ready } from "./client";
import { prepareDatabaseExperiment } from "./prepare";
import type { DatabaseSample } from "./sample";
import { deployTemporaryWorker } from "./temporaryWorker";

const defaultDependencies = {
  prepare: prepareDatabaseExperiment,
  deploy: deployTemporaryWorker,
  openTail: openCloudflareTail,
  ready,
  collectSamples,
};

type Tail = Awaited<ReturnType<typeof openCloudflareTail>>;

function tailEvidence(
  tail: Tail | undefined,
  samples: DatabaseSample[],
  runId: string,
) {
  return tail
    ? {
        events: tail.events,
        warnings: tail.warnings,
        unmatchedSamples: samples
          .filter(
            (sample) =>
              !tail.events.some(
                (event) => event.requestId === `${runId}-${sample.index}-1`,
              ),
          )
          .map((sample) => sample.index),
      }
    : null;
}

export async function runDatabaseExperiment(
  options: Options,
  signal: AbortSignal,
  dependencies = defaultDependencies,
) {
  const {
    api,
    config,
    bundle,
    token,
    expires,
    writer,
    samples,
    report,
    runId,
    name,
  } = await dependencies.prepare(options);
  let tail: Awaited<ReturnType<typeof openCloudflareTail>> | undefined;
  const save = () =>
    writer.save({ ...report, cloudflare: tailEvidence(tail, samples, runId) });
  await save();
  console.info(`Report: ${writer.path}\nTemporary Worker: ${name}`);
  let worker: Awaited<ReturnType<typeof deployTemporaryWorker>> | undefined;
  const errors: string[] = [];
  try {
    signal.throwIfAborted();
    report.cleanup = "pending";
    worker = await dependencies.deploy(api, {
      name,
      runId,
      token,
      expires,
      bundle: bundle.blob,
      config,
    });
    if (options.cloudflare) tail = await dependencies.openTail(name, runId);
    const headers = { authorization: `Bearer ${token}`, [runHeader]: runId };
    await dependencies.ready(worker.origin, headers, runId, signal);
    await dependencies.collectSamples({
      origin: worker.origin,
      headers,
      runId,
      count: options.samples,
      signal,
      onSample: async (sample) => {
        samples.push(sample);
        await save();
      },
    });
    const deadline = performance.now() + 5_000;
    while (
      tail &&
      tail.events.length < samples.length &&
      performance.now() < deadline
    )
      await delay(100, undefined, { signal });
    signal.throwIfAborted();
    report.status = "complete";
  } catch (error) {
    report.status = "failed";
    errors.push(error instanceof Error ? error.message : "Experiment failed.");
  } finally {
    try {
      await tail?.close();
    } catch {
      errors.push("Tail cleanup failed.");
    }
    try {
      if (report.cleanup === "pending") {
        if (worker) await worker.close();
        report.cleanup = (await api(`/workers/scripts/${name}/settings`))
          ? "failed"
          : "deleted";
      }
    } catch {
      report.cleanup = "failed";
    }
    if (report.cleanup === "failed")
      errors.push(
        `Temporary Worker cleanup failed: ${name}; access expires at ${report.expiresAt}.`,
      );
    if (errors.length) report.status = "failed";
    try {
      await save();
    } catch {
      errors.push(`Final report write failed: ${writer.path}`);
    }
  }
  if (errors.length) throw new Error(errors.join(" "));
  return true;
}
