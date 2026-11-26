import { parseArgs } from "node:util";

/** The hub refuses a declaration of more ids than this. */
const MAX_DECLARED_IDS = 10_000;

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

function integer(value: string, name: string, min: number, max: number) {
  if (!/^[1-9]\d*$/.test(value) || Number(value) < min || Number(value) > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return Number(value);
}

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
  const sizes = values.sizes
    .split(",")
    .map((size) => integer(size.trim(), "--sizes", 1, MAX_DECLARED_IDS));
  if (sizes.some((size, index) => index > 0 && size <= (sizes[index - 1] ?? 0)))
    throw new Error("--sizes must be strictly ascending.");
  return {
    sizes,
    fanout: integer(values.fanout, "--fanout", 1, MAX_DECLARED_IDS),
    samples: integer(values.samples, "--samples", 1, 10),
    reuse: values.reuse,
  };
}
