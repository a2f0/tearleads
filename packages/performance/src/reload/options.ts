import { ascendingIntegers, integer } from "../inProcess/optionValues";

export interface ReloadOptions {
  /** Note counts the account grows to, ascending. */
  readonly documents: readonly number[];
  /** Notes per folder; folders are created under the root as needed. */
  readonly perFolder: number;
  /** Settled reloads measured at each size, after the first. */
  readonly samples: number;
  /** How long no request may start or finish before a reload counts as settled. */
  readonly quietMs: number;
  /** Simulated WebSocket interest-acknowledgement delay in milliseconds. */
  readonly ackDelayMs: number;
  /** Notes created by an independent second device before a `peer-edited` reload. */
  readonly peerEdits: number;
}

const MAX_DOCUMENTS = 5_000;

export const reloadUsage = `Count the requests a returning client makes when it reloads.

DATABASE_URL=postgres://$USER@localhost:5432/<scratch> \\
  bun run perf:reload [--documents 10,100,1000] [--per-folder 10] \\
    [--samples 3] [--quiet-ms 1000] [--ack-delay-ms 0] [--peer-edits 0]

Boots the API in this process against a local scratch database and registers
one account through the SDK. For each --documents size, the account grows to
that many notes, --per-folder to a folder under its root, created as the app
creates them. Then the SDK is disposed and built again over the same local
database, restoring the identity and session as the app does on a page load,
once for the first reload after the notes were created and --samples more
times with nothing changed. With --ack-delay-ms, marks the server-events
connection acknowledged after that delay so escaping pre-ack work is visible.
With --peer-edits, an independent second device adds that many notes and a
peer-edited reload is measured. Reports are saved under
.test_files/performance/.`;

function nonNegativeInteger(value: string, name: string, max: number): number {
  if (value === "0") return 0;
  return integer(value, name, 1, max);
}

interface MutableReloadOptions {
  documents: number[];
  perFolder: number;
  samples: number;
  quietMs: number;
  ackDelayMs: number;
  peerEdits: number;
}

function applyReloadOption(
  options: MutableReloadOptions,
  flag: string,
  value: string,
): void {
  switch (flag) {
    case "--documents":
      options.documents = ascendingIntegers(value, flag, 1, MAX_DOCUMENTS);
      return;
    case "--per-folder":
      options.perFolder = integer(value, flag, 1, MAX_DOCUMENTS);
      return;
    case "--samples":
      options.samples = integer(value, flag, 1, 10);
      return;
    case "--quiet-ms":
      options.quietMs = integer(value, flag, 100, 10_000);
      return;
    case "--ack-delay-ms":
      options.ackDelayMs = nonNegativeInteger(value, flag, 5_000);
      return;
    case "--peer-edits":
      options.peerEdits = nonNegativeInteger(value, flag, 500);
      return;
    default:
      throw new Error(`Unknown option ${flag}.`);
  }
}

export function parseReloadOptions(
  args: readonly string[],
): ReloadOptions | null {
  const options: MutableReloadOptions = {
    documents: [10, 100, 1000],
    perFolder: 10,
    samples: 3,
    quietMs: 1000,
    ackDelayMs: 0,
    peerEdits: 0,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") return null;
    if (!flag) continue;
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value.`);
    index += 1;
    applyReloadOption(options, flag, value);
  }
  return options;
}
