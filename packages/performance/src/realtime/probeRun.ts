import { cpus } from "node:os";
import { sourceIdentity } from "../database/artifacts";
import {
  loadSeededTree,
  type SeededTree,
  saveJson,
  seedFileName,
} from "./artifacts";
import { type InProcessApi, startInProcessApi } from "./inProcessApi";
import { parseLocalDatabaseUrl, startPostgresProxy } from "./postgresProxy";
import type { PostgresTraffic } from "./postgresWire";
import { seedTree } from "./run";

/** The seeding choices every realtime probe accepts. */
interface SeedOptions {
  /** Declared folder counts, ascending; the largest sets the seeded tree. */
  readonly sizes: readonly number[];
  readonly fanout: number;
  /** Measure the account an earlier run seeded instead of seeding anew. */
  readonly reuse: boolean;
}

/** What a probe adds to its report; nothing else can overwrite metadata. */
interface ProbeResults {
  readonly summary: readonly object[];
  readonly measurements: readonly object[];
}

export interface ProbeContext {
  readonly api: InProcessApi;
  readonly seed: SeededTree;
  readonly traffic: () => PostgresTraffic;
  /** Rewrites the report with the measurements so far. */
  readonly progress: () => Promise<void>;
}

async function seedOrReuse(
  options: SeedOptions,
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

/**
 * Boots the API in this process against the local database named by
 * `DATABASE_URL`, through a counting proxy, seeds or reuses the measured
 * account, and runs `measure`. The report is saved after every measurement
 * and once more when the run ends, however it ends.
 */
export async function runRealtimeProbe(input: {
  readonly scenario: string;
  readonly reportPrefix: string;
  readonly options: SeedOptions;
  readonly measure: (context: ProbeContext) => Promise<void>;
  /** The report's measurement fields, read at every save. */
  readonly results: () => ProbeResults;
}): Promise<void> {
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
  const reportName = `${input.reportPrefix}-${runId}.json`;
  const metadata = {
    schemaVersion: 1,
    scenario: input.scenario,
    runId,
    startedAt: new Date().toISOString(),
    database,
    options: input.options,
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
  const save = (status: "running" | "complete" | "failed") => {
    const { summary, measurements } = input.results();
    return saveJson(reportName, {
      ...metadata,
      updatedAt: new Date().toISOString(),
      status,
      seed: seed && {
        userId: seed.userId,
        folders: seed.containerIds.length,
        seededAt: seed.seededAt,
        seedMs: seed.seedMs,
        reused: input.options.reuse,
      },
      summary,
      measurements,
    });
  };
  const api = await startInProcessApi();
  let status: "complete" | "failed" = "failed";
  try {
    seed = await seedOrReuse(input.options, database, api);
    await input.measure({
      api,
      seed,
      traffic: proxy.snapshot,
      progress: async () => {
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
