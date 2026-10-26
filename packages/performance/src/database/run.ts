import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { openCloudflareTail } from "../cloudflare";
import { type Options, targets } from "../options";
import { runHeader } from "../transport";
import { databaseReport, sourceIdentity } from "./artifacts";
import { buildProbe } from "./bundle";
import { collectSamples, ready } from "./client";
import { createCloudflareApi } from "./cloudflareApi";
import { readDeployedConfig } from "./deployedConfig";
import type { DatabaseSample } from "./sample";
import { deployTemporaryWorker } from "./temporaryWorker";

async function prepare(options: Options) {
  const runId = crypto.randomUUID();
  const name = `tl-db-probe-${options.environment}-${runId}`;
  const api = createCloudflareApi();
  const config = await readDeployedConfig(
    api,
    targets[options.environment].worker,
    options.environment,
  );
  const bundle = await buildProbe();
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + 30 * 60_000;
  const writer = await databaseReport(options.environment, runId);
  const samples: DatabaseSample[] = [];
  const report = {
    schemaVersion: 1,
    scenario: "database-round-trips",
    runId,
    environment: options.environment,
    apiWorker: targets[options.environment].worker,
    worker: name,
    expiresAt: new Date(expires).toISOString(),
    startedAt: new Date().toISOString(),
    ...sourceIdentity(),
    bundleSha256: bundle.sha256,
    configuration: {
      compatibilityDate: config.compatibilityDate,
      compatibilityFlags: config.compatibilityFlags,
      placement: config.placement,
      uploadPlacement: config.uploadPlacement,
      poolBindings: config.poolBindings,
      queryCacheDisabled: true,
    },
    requestedSamples: options.samples,
    status: "running",
    cleanup: "not-created",
    samples,
  };
  return {
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
  };
}

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
  } = await prepare(options);
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
    worker = await deployTemporaryWorker(api, {
      name,
      runId,
      token,
      expires,
      bundle: bundle.blob,
      config,
    });
    if (options.cloudflare) tail = await openCloudflareTail(name, runId);
    const headers = { authorization: `Bearer ${token}`, [runHeader]: runId };
    await ready(worker.origin, headers, runId, signal);
    await collectSamples({
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
      if (worker) await worker.close();
      if (
        report.cleanup === "pending" &&
        (await api(`/workers/scripts/${name}/settings`))
      )
        report.cleanup = "failed";
      else report.cleanup = "deleted";
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
