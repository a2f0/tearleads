import { cpus } from "node:os";
import { sourceIdentity } from "../database/artifacts";
import {
  loadSeededTree,
  type SeededTree,
  saveJson,
  seedFileName,
} from "./artifacts";
import { type InProcessApi, startInProcessApi } from "./inProcessApi";
import type { PassMeasurement } from "./measurePass";
import {
  parseRealtimeOptions,
  type RealtimeOptions,
  realtimeUsage,
} from "./options";
import { parseLocalDatabaseUrl, startPostgresProxy } from "./postgresProxy";
import { measureSizes, seedTree } from "./run";
import { formatMeasurement, summarize } from "./summary";

async function seedOrReuse(
  options: RealtimeOptions,
  database: string,
  api: InProcessApi,
): Promise<SeededTree> {
  if (options.reuse) {
    const seed = await loadSeededTree(database);
    if (seed.fanout !== options.fanout)
      throw new Error(`The seeded tree has --fanout ${seed.fanout}.`);
    console.log(`Reusing ${seed.containerIds.length} seeded folders.`);
    return seed;
  }
  const size = options.sizes.at(-1) ?? 0;
  console.log(`Seeding ${size} folders through the SDK.`);
  let reported = 0;
  const seed = await seedTree({
    api,
    database,
    fanout: options.fanout,
    size,
    progress: (held) => {
      if (held - reported < 500 && held < size) return;
      reported = held;
      console.log(`  ${held} folders`);
    },
  });
  await saveJson(seedFileName(database), seed);
  console.log(`Seeded in ${(seed.seedMs / 1000).toFixed(1)} s.`);
  return seed;
}

async function main(): Promise<void> {
  const options = parseRealtimeOptions(process.argv.slice(2));
  if (!options) {
    console.log(realtimeUsage);
    return;
  }
  const { DATABASE_URL: databaseUrl } = process.env;
  const target = parseLocalDatabaseUrl(databaseUrl);
  const database = decodeURIComponent(target.pathname.slice(1));
  const proxy = await startPostgresProxy(target);
  // The API reads its database configuration when it loads.
  Object.assign(process.env, {
    API_DATABASE: "postgres",
    DATABASE_URL: proxy.url,
  });
  const runId = crypto.randomUUID();
  const reportName = `realtime-${runId}.json`;
  const measurements: PassMeasurement[] = [];
  const metadata = {
    schemaVersion: 1,
    scenario: "realtime-container-interest",
    runId,
    startedAt: new Date().toISOString(),
    database,
    options,
    ...sourceIdentity(),
    runtime: {
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? null,
    },
    boundary:
      "In-process API on Bun and local PostgreSQL through a counting proxy; not workerd, Hyperdrive, or the hub Durable Object",
  };
  let seed: SeededTree | null = null;
  const save = (status: "running" | "complete" | "failed") =>
    saveJson(reportName, {
      ...metadata,
      updatedAt: new Date().toISOString(),
      status,
      seed: seed && {
        userId: seed.userId,
        folders: seed.containerIds.length,
        seededAt: seed.seededAt,
        seedMs: seed.seedMs,
        reused: options.reuse,
      },
      summary: summarize(measurements),
      measurements,
    });
  const api = await startInProcessApi();
  let status: "complete" | "failed" = "failed";
  try {
    seed = await seedOrReuse(options, database, api);
    await measureSizes({
      api,
      options,
      seed,
      traffic: proxy.snapshot,
      measured: async (measurement) => {
        measurements.push(measurement);
        console.log(formatMeasurement(measurement));
        await save("running");
      },
    });
    status = "complete";
  } finally {
    console.log(`Report: ${await save(status)}`);
    await api.stop();
    await proxy.stop();
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
