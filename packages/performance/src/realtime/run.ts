import type { InProcessApi } from "../inProcess/inProcessApi";
import type { PostgresTraffic } from "../inProcess/postgresWire";
import type { SeededTree } from "./artifacts";
import { openFolderAccount } from "./folderTree";
import { openHubSocket } from "./hubSocket";
import { measurePass, type PassMeasurement } from "./measurePass";
import type { RealtimeOptions } from "./options";

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
      rootContainerIds: account.rootContainerIds(),
      seededAt: new Date().toISOString(),
      seedMs: Math.round(performance.now() - started),
    };
  } finally {
    account.close();
  }
}

/**
 * For each size and sample, a fresh hub socket declares either the first
 * `size` folders (`mode === "all"`) or only the root-lane entries
 * (`mode === "roots"`), then runs one revalidation pass over them.
 */
export async function measureSizes(input: {
  readonly api: InProcessApi;
  readonly options: RealtimeOptions;
  readonly seed: SeededTree;
  readonly traffic: () => PostgresTraffic;
  readonly measured: (measurement: PassMeasurement) => Promise<void>;
}): Promise<void> {
  const rootIds =
    input.seed.rootContainerIds ?? input.seed.containerIds.slice(0, 4);
  for (const size of input.options.sizes) {
    if (input.seed.containerIds.length < size)
      throw new Error(
        `The seeded tree holds only ${input.seed.containerIds.length} folders.`,
      );
    const ids =
      input.options.mode === "roots"
        ? rootIds.slice(0, size)
        : input.seed.containerIds.slice(0, size);
    for (let sample = 1; sample <= input.options.samples; sample++) {
      const socket = openHubSocket(input.api, input.seed.userId);
      try {
        const common = {
          expectedAuthorized: ids.length,
          size,
          sample,
          traffic: input.traffic,
        };
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
