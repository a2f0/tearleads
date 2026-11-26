import { runInProcessProbe } from "../inProcessProbe";
import {
  loadSeededTree,
  type SeededTree,
  saveJson,
  seedFileName,
} from "./artifacts";
import type { InProcessApi } from "./inProcessApi";
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

/** What a realtime probe adds to its report. */
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
 * Runs a realtime probe in process (see `runInProcessProbe`) against an
 * account whose folder tree it seeds, or reuses from an earlier run.
 */
export async function runRealtimeProbe(input: {
  readonly scenario: string;
  readonly reportPrefix: string;
  readonly options: SeedOptions;
  readonly measure: (context: ProbeContext) => Promise<void>;
  /** The report's measurement fields, read at every save. */
  readonly results: () => ProbeResults;
}): Promise<void> {
  let seed: SeededTree | null = null;
  await runInProcessProbe({
    scenario: input.scenario,
    reportPrefix: input.reportPrefix,
    options: input.options,
    boundary:
      "In-process API on Bun and local PostgreSQL through a counting proxy; not workerd, Hyperdrive, or the hub Durable Object",
    run: async ({ api, database, traffic, progress }) => {
      seed = await seedOrReuse(input.options, database, api);
      await input.measure({ api, seed, traffic, progress });
    },
    results: () => {
      const { summary, measurements } = input.results();
      return {
        seed: seed && {
          userId: seed.userId,
          folders: seed.containerIds.length,
          seededAt: seed.seededAt,
          seedMs: seed.seedMs,
          reused: input.options.reuse,
        },
        summary,
        measurements,
      };
    },
  });
}
