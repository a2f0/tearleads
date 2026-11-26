import { ascendingIntegers, integer } from "../realtime/optionValues";

export interface ReloadOptions {
  /** Note counts the account grows to, ascending. */
  readonly documents: readonly number[];
  /** Notes per folder; folders are created under the root as needed. */
  readonly perFolder: number;
  /** Settled reloads measured at each size, after the first. */
  readonly samples: number;
  /** How long no request may start or finish before a reload counts as settled. */
  readonly quietMs: number;
}

const MAX_DOCUMENTS = 5_000;

export const reloadUsage = `Count the requests a returning client makes when it reloads.

DATABASE_URL=postgres://$USER@localhost:5432/<scratch> \\
  bun run perf:reload [--documents 10,100,1000] [--per-folder 10] \\
    [--samples 3] [--quiet-ms 1000]

Boots the API in this process against a local scratch database and registers
one account through the SDK. For each --documents size, the account grows to
that many notes, --per-folder to a folder under its root, created as the app
creates them. Then the SDK is disposed and built again over the same local
database, restoring the identity and session as the app does on a page load,
once for the first reload after the notes were created and --samples more
times with nothing changed. Each reload is counted by route until no request
has started or finished for --quiet-ms. Reports are saved under
.test_files/performance/.`;

export function parseReloadOptions(
  args: readonly string[],
): ReloadOptions | null {
  const options = {
    documents: [10, 100, 1000],
    perFolder: 10,
    samples: 3,
    quietMs: 1000,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") return null;
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value.`);
    index += 1;
    if (flag === "--documents")
      options.documents = ascendingIntegers(value, flag, 1, MAX_DOCUMENTS);
    else if (flag === "--per-folder")
      options.perFolder = integer(value, flag, 1, MAX_DOCUMENTS);
    else if (flag === "--samples")
      options.samples = integer(value, flag, 1, 10);
    else if (flag === "--quiet-ms")
      options.quietMs = integer(value, flag, 100, 10_000);
    else throw new Error(`Unknown option ${flag}.`);
  }
  return options;
}
