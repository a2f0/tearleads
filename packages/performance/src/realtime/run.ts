import type { SeededTree } from "./artifacts";
import { openFolderAccount } from "./folderTree";
import { openHubSocket } from "./hubSocket";
import type { InProcessApi } from "./inProcessApi";
import { measurePass, type PassMeasurement } from "./measurePass";
import type { RealtimeOptions } from "./options";
import type { PostgresTraffic } from "./postgresWire";

/** Seeds one account whose tree holds `size` folders in all. */
export async function seedTree(input: {
  readonly api: InProcessApi;
  readonly database: string;
  readonly fanout: number;
  readonly size: number;
  readonly progress: (held: number) => void;
}): Promise<SeededTree> {
  const started = performance.now();
  const account = await openFolderAccount(input.api.origin);
  try {
    await account.grow(input.size, input.fanout, input.progress);
    return {
      schemaVersion: 1,
      database: input.database,
      userId: account.userId,
      fanout: input.fanout,
      containerIds: account.declarationOrder(),
      seededAt: new Date().toISOString(),
      seedMs: Math.round(performance.now() - started),
    };
  } finally {
    account.close();
  }
}

/**
 * For each size and sample, a fresh hub socket declares the first `size`
 * folders of the seeded tree, then runs one revalidation pass over them.
 */
export async function measureSizes(input: {
  readonly api: InProcessApi;
  readonly options: RealtimeOptions;
  readonly seed: SeededTree;
  readonly traffic: () => PostgresTraffic;
  readonly measured: (measurement: PassMeasurement) => Promise<void>;
}): Promise<void> {
  for (const size of input.options.sizes) {
    const ids = input.seed.containerIds.slice(0, size);
    if (ids.length < size)
      throw new Error(`The seeded tree holds only ${ids.length} folders.`);
    for (let sample = 1; sample <= input.options.samples; sample++) {
      const socket = openHubSocket(input.api, input.seed.userId);
      try {
        const common = { size, sample, traffic: input.traffic };
        await input.measured(
          await measurePass({
            ...common,
            pass: "declaration",
            run: () => socket.declare(ids),
          }),
        );
        await input.measured({
          ...(await measurePass({
            ...common,
            pass: "revalidation",
            run: () => socket.revalidate(),
          })),
          snapshot: socket.snapshotSize(),
        });
      } finally {
        socket.close();
      }
    }
  }
}
