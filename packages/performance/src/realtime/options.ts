import { parseArgs } from "node:util";
import { ascendingIntegers, integer, MAX_DECLARED_IDS } from "./optionValues";

export interface RealtimeOptions {
  /** Declared folder counts, ascending; the largest sets the seeded tree. */
  readonly sizes: readonly number[];
  readonly fanout: number;
  readonly samples: number;
  /** Measure the account an earlier run seeded instead of seeding anew. */
  readonly reuse: boolean;
}

export const realtimeUsage = `Measure the realtime hub's container interest authorization.

DATABASE_URL=postgres://$USER@localhost:5432/<scratch> \\
  bun run perf:realtime [--sizes 100,1000,10000] [--fanout 10] [--samples 1..10] [--reuse]

Boots the API in this process against a local scratch database, seeds one
account's folder tree through the SDK, then times one declaration and one
revalidation pass per size and sample on a fresh hub socket. Each size
declares the first folders of a breadth-first tree with --fanout children
per folder. --reuse measures the account a previous run seeded in the same
database. Reports are saved under .test_files/performance/.`;

export function parseRealtimeOptions(args: string[]): RealtimeOptions | null {
  const { values } = parseArgs({
    args,
    options: {
      sizes: { type: "string", default: "100,1000,10000" },
      fanout: { type: "string", default: "10" },
      samples: { type: "string", default: "1" },
      reuse: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return null;
  return {
    sizes: ascendingIntegers(values.sizes, "--sizes", 1, MAX_DECLARED_IDS),
    fanout: integer(values.fanout, "--fanout", 1, MAX_DECLARED_IDS),
    samples: integer(values.samples, "--samples", 1, 10),
    reuse: values.reuse,
  };
}
