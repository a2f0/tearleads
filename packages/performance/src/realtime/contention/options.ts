import { parseArgs } from "node:util";

/** The hub refuses a declaration of more ids than this. */
const MAX_DECLARED_IDS = 10_000;
// The root and the three system containers registration provisions.
const MIN_DECLARED_IDS = 4;
// Each socket holds a full pass's rows and bundles in memory at once.
const MAX_SOCKETS = 8;

export interface ContentionOptions {
  /** Folders each socket declares, ascending; the largest sets the tree. */
  readonly sizes: readonly number[];
  /** How many sockets run their passes at once, ascending. */
  readonly sockets: readonly number[];
  readonly fanout: number;
  readonly samples: number;
  /** How often a hint is published for the observing socket. */
  readonly hintIntervalMs: number;
  /** Measure the account an earlier run seeded instead of seeding anew. */
  readonly reuse: boolean;
}

export const contentionUsage = `Measure how the realtime hub's container authorization delays other work.

DATABASE_URL=postgres://$USER@localhost:5432/<scratch> \\
  bun run perf:realtime-contention [--sizes 1000,10000] [--sockets 1,2,4] \\
    [--fanout 10] [--samples 1..10] [--hint-interval-ms 10] [--reuse]

Boots the API in this process against a local scratch database and seeds one
account's folder tree through the SDK, or reuses the tree perf:realtime
seeded. First one socket declares the largest size with no verification
marker this process accepts, so every manifest is verified in full. Then, for
each size, socket count and sample, a fresh gateway opens an observing socket
that holds one folder, then that many sockets that each declare the first
--sizes folders at once and then revalidate them at once.
A hint for the observer's folder is published every --hint-interval-ms
throughout, and each is timed until the observer receives it. Reports are
saved under .test_files/performance/.`;

function integer(value: string, name: string, min: number, max: number) {
  if (!/^[1-9]\d*$/.test(value) || Number(value) < min || Number(value) > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return Number(value);
}

function ascending(
  value: string,
  name: string,
  min: number,
  max: number,
): number[] {
  const values = value
    .split(",")
    .map((item) => integer(item.trim(), name, min, max));
  if (
    values.some((item, index) => index > 0 && item <= (values[index - 1] ?? 0))
  )
    throw new Error(`${name} must be strictly ascending.`);
  return values;
}

export function parseContentionOptions(
  args: string[],
): ContentionOptions | null {
  const { values } = parseArgs({
    args,
    options: {
      sizes: { type: "string", default: "1000,10000" },
      sockets: { type: "string", default: "1,2,4" },
      fanout: { type: "string", default: "10" },
      samples: { type: "string", default: "1" },
      "hint-interval-ms": { type: "string", default: "10" },
      reuse: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return null;
  return {
    sizes: ascending(
      values.sizes,
      "--sizes",
      MIN_DECLARED_IDS,
      MAX_DECLARED_IDS,
    ),
    sockets: ascending(values.sockets, "--sockets", 1, MAX_SOCKETS),
    fanout: integer(values.fanout, "--fanout", 1, MAX_DECLARED_IDS),
    samples: integer(values.samples, "--samples", 1, 10),
    hintIntervalMs: integer(
      values["hint-interval-ms"],
      "--hint-interval-ms",
      1,
      1_000,
    ),
    reuse: values.reuse,
  };
}
