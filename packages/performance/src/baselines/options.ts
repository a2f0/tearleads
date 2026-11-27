import { ascendingIntegers, integer } from "../inProcess/optionValues";

export interface BaselineOptions {
  /** Document history sizes in MiB to measure at, ascending. */
  readonly sizesMb: readonly number[];
  /** Maximum MiB per seeding write (must fit under single-request sync cap). */
  readonly chunkMb: number;
  /** Repeated runs per size tier. */
  readonly samples: number;
  /** Inject a racing peer write before `POST /unlink` to exercise 409 tail retry. */
  readonly race: boolean;
}

const MAX_SIZE_MB = 32;
const MAX_CHUNK_MB = 10;

export const baselineUsage = `Measure rotation baseline scaling across inline, multi-segment, staged, and racing-write retry paths.

DATABASE_URL=postgres://$USER@localhost:5432/<scratch> \\
  bun run perf:baselines [--sizes-mb 1,5,13] [--chunk-mb 6] [--samples 1] [--race]

Boots the API in this process against a local scratch PostgreSQL database
through a counting PostgreSQL wire proxy and a counting HTTP proxy. For each
--sizes-mb tier, seeds an incompressible multi-linked document in --chunk-mb
writes and measures:
  - seed-history: chunked creation/editing up to sizeMiB
  - first-unlink-rotate: unlinking the second folder (inline or /baseline-stages,
    plus 409 stale-baseline tail retry when --race is passed)
  - fresh-reader-sync: empty-DB install discovering and decrypting the full document
  - second-unlink-rotate: re-linking and unlinking again across an existing baseline group

Reports are saved under .test_files/performance/ as JSON and Markdown.`;

interface MutableBaselineOptions {
  sizesMb: number[];
  chunkMb: number;
  samples: number;
  race: boolean;
}

function applyValueOption(
  options: MutableBaselineOptions,
  flag: string,
  value: string,
): void {
  switch (flag) {
    case "--sizes-mb":
      options.sizesMb = ascendingIntegers(value, flag, 1, MAX_SIZE_MB);
      return;
    case "--chunk-mb":
      options.chunkMb = integer(value, flag, 1, MAX_CHUNK_MB);
      return;
    case "--samples":
      options.samples = integer(value, flag, 1, 5);
      return;
    default:
      throw new Error(`Unknown option ${flag}.`);
  }
}

export function parseBaselineOptions(
  args: readonly string[],
): BaselineOptions | null {
  const options: MutableBaselineOptions = {
    sizesMb: [1, 5, 13],
    chunkMb: 6,
    samples: 1,
    race: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") return null;
    if (!flag) continue;
    if (flag === "--race") {
      options.race = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value.`);
    index += 1;
    applyValueOption(options, flag, value);
  }
  return options;
}
