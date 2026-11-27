import { ascendingIntegers, integer } from "../inProcess/optionValues";

export interface RotationOptions {
  /** Rotation rounds to measure at, ascending. */
  readonly rotations: readonly number[];
  /** Nested folder chain depth (`f1 -> ... -> fD`) for carry and move passes. */
  readonly depth: number;
  /** Repeated runs at each rotation tier. */
  readonly samples: number;
}

const MAX_ROTATIONS = 32;
const MAX_DEPTH = 8;

export const rotationUsage = `Measure key rotation, group shrink carry, revocation, stale-writer repair, and fresh-device keyring hydration.

DATABASE_URL=postgres://$USER@localhost:5432/<scratch> \\
  bun run perf:rotations [--rotations 1,4,8] [--depth 3] [--samples 1]

Boots the API in this process against a local scratch PostgreSQL database
through a counting PostgreSQL wire proxy and a counting HTTP proxy. For each
--rotations tier, creates an organization with a nested folder chain of length
--depth, shares the top folder to a group and the bottom folder directly to a
deeper grantee, accumulates that many group add/remove rotations, and measures:
group-share, group-shrink, stale-writer-repair, direct-revoke,
grantee-subtree-repair (when --depth >= 2), subtree-move,
fresh-reader-hydration, and roster-vouched-share. Reports are saved under
.test_files/performance/ as JSON and Markdown.`;

interface MutableRotationOptions {
  rotations: number[];
  depth: number;
  samples: number;
}

function applyOption(
  options: MutableRotationOptions,
  flag: string,
  value: string,
): void {
  switch (flag) {
    case "--rotations":
      options.rotations = ascendingIntegers(value, flag, 1, MAX_ROTATIONS);
      return;
    case "--depth":
      options.depth = integer(value, flag, 1, MAX_DEPTH);
      return;
    case "--samples":
      options.samples = integer(value, flag, 1, 5);
      return;
    default:
      throw new Error(`Unknown option ${flag}.`);
  }
}

export function parseRotationOptions(
  args: readonly string[],
): RotationOptions | null {
  const options: MutableRotationOptions = {
    rotations: [1, 4, 8],
    depth: 3,
    samples: 1,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") return null;
    if (!flag) continue;
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value.`);
    index += 1;
    applyOption(options, flag, value);
  }
  return options;
}
