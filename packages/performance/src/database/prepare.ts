import { randomBytes } from "node:crypto";
import { type Options, targets } from "../options";
import { databaseReport, sourceIdentity } from "./artifacts";
import { buildProbe } from "./bundle";
import { createCloudflareApi } from "./cloudflareApi";
import { readDeployedConfig } from "./deployedConfig";
import type { DatabaseSample } from "./sample";

export async function prepareDatabaseExperiment(options: Options) {
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
