import type { EpochEntryKind } from "./schema";

export type EpochOptions =
  | {
      readonly mode: "record";
      readonly id: string;
      readonly label: string;
      readonly kind: EpochEntryKind;
      readonly pr?: number;
      readonly issues: readonly number[];
      readonly notes?: string;
      readonly canaries?: string;
      readonly inventory?: string;
      readonly plans?: string;
      readonly scenarios?: string;
      readonly reload?: string;
      readonly realtime?: string;
      readonly rotations?: string;
      readonly baselines?: string;
      readonly resultsDir?: string;
    }
  | {
      readonly mode: "analyze";
      readonly from?: string;
      readonly to?: string;
      readonly json: boolean;
      readonly resultsDir?: string;
    }
  | {
      readonly mode: "render";
      readonly resultsDir?: string;
    };

export const epochUsage = `Usage:
  bun run perf:epoch record --id <id> --label <text> [options]
  bun run perf:epoch analyze [--from <id>] [--to <id>] [--json]
  bun run perf:epoch render

Record options:
  --id <id>             Unique checkpoint slug (e.g. 000-baseline, 001-fix-3289)
  --label <text>        Human-readable checkpoint label
  --kind <kind>         baseline | checkpoint | final (default: checkpoint)
  --pr <number>         Optional PR number
  --issues <csv>        Comma-separated GitHub issue numbers (e.g. 3396,3342)
  --notes <text>        Optional tradeoff or measurement note
  --canaries <path>     Path to perf:canaries JSON report
  --inventory <path>    Path to perf:inventory JSON report
  --plans <path>        Path to perf:plans JSON report
  --scenarios <path>    Path to perf:scenarios JSON report
  --reload <path>       Path to perf:reload JSON report
  --realtime <path>     Path to perf:realtime JSON report
  --rotations <path>    Path to perf:rotations JSON report
  --baselines <path>    Path to perf:baselines JSON report
  --results-dir <path>  Override results directory (default: packages/performance/results)`;

function nextValue(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

const positiveIntPattern = /^[1-9]\d*$/u;

function parsePositiveInt(raw: string, flag: string): number {
  if (!positiveIntPattern.test(raw)) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return Number.parseInt(raw, 10);
}

function parseIssueList(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim().replace(/^#/, ""))
    .filter((part) => part.length > 0)
    .map((part) => {
      if (!positiveIntPattern.test(part)) {
        throw new Error(`Invalid issue number: ${part}`);
      }
      return Number.parseInt(part, 10);
    });
}

function parseKind(raw: string): EpochEntryKind {
  if (raw === "baseline" || raw === "checkpoint" || raw === "final") return raw;
  throw new Error(
    `Invalid --kind '${raw}'; expected baseline, checkpoint, or final.`,
  );
}

function parseRenderOptions(
  rest: readonly string[],
): Extract<EpochOptions, { mode: "render" }> {
  let resultsDir: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--results-dir") {
      resultsDir = nextValue(rest, i, arg);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { mode: "render", ...(resultsDir ? { resultsDir } : {}) };
}

function parseAnalyzeOptions(
  rest: readonly string[],
): Extract<EpochOptions, { mode: "analyze" }> {
  let from: string | undefined;
  let to: string | undefined;
  let json = false;
  let resultsDir: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--from") {
      from = nextValue(rest, i, arg);
      i += 1;
    } else if (arg === "--to") {
      to = nextValue(rest, i, arg);
      i += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--results-dir") {
      resultsDir = nextValue(rest, i, arg);
      i += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return {
    mode: "analyze",
    json,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(resultsDir ? { resultsDir } : {}),
  };
}

const recordStringFlags = new Set([
  "--id",
  "--label",
  "--notes",
  "--canaries",
  "--inventory",
  "--plans",
  "--scenarios",
  "--reload",
  "--realtime",
  "--rotations",
  "--baselines",
  "--results-dir",
]);

function pickRecordPaths(strings: ReadonlyMap<string, string>) {
  const notes = strings.get("--notes");
  const canaries = strings.get("--canaries");
  const inventory = strings.get("--inventory");
  const plans = strings.get("--plans");
  const scenarios = strings.get("--scenarios");
  const reload = strings.get("--reload");
  const realtime = strings.get("--realtime");
  const rotations = strings.get("--rotations");
  const baselines = strings.get("--baselines");
  const resultsDir = strings.get("--results-dir");
  return {
    ...(notes !== undefined ? { notes } : {}),
    ...(canaries !== undefined ? { canaries } : {}),
    ...(inventory !== undefined ? { inventory } : {}),
    ...(plans !== undefined ? { plans } : {}),
    ...(scenarios !== undefined ? { scenarios } : {}),
    ...(reload !== undefined ? { reload } : {}),
    ...(realtime !== undefined ? { realtime } : {}),
    ...(rotations !== undefined ? { rotations } : {}),
    ...(baselines !== undefined ? { baselines } : {}),
    ...(resultsDir !== undefined ? { resultsDir } : {}),
  };
}

function requireIdAndLabel(strings: ReadonlyMap<string, string>) {
  const id = strings.get("--id") ?? "";
  const label = (strings.get("--label") ?? "").trim();
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(id)) {
    throw new Error("--id is required and must match /^[a-z0-9][a-z0-9_-]*$/.");
  }
  if (label.length === 0) throw new Error("--label is required.");
  return { id, label };
}

function isRecordFlag(arg: string): boolean {
  return (
    recordStringFlags.has(arg) ||
    arg === "--kind" ||
    arg === "--pr" ||
    arg === "--issues"
  );
}

function parseRecordOptions(
  rest: readonly string[],
): Extract<EpochOptions, { mode: "record" }> {
  const strings = new Map<string, string>();
  let kind: EpochEntryKind = "checkpoint";
  let pr: number | undefined;
  const issues: number[] = [];

  for (let i = 0; i < rest.length; i += 2) {
    const arg = rest[i] ?? "";
    if (!isRecordFlag(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = nextValue(rest, i, arg);
    if (recordStringFlags.has(arg)) strings.set(arg, value);
    else if (arg === "--kind") kind = parseKind(value);
    else if (arg === "--pr") pr = parsePositiveInt(value, arg);
    else if (arg === "--issues") issues.push(...parseIssueList(value));
  }

  return {
    mode: "record",
    ...requireIdAndLabel(strings),
    kind,
    issues: [...new Set(issues)].sort((a, b) => a - b),
    ...(pr !== undefined ? { pr } : {}),
    ...pickRecordPaths(strings),
  };
}

export function parseEpochOptions(
  args: readonly string[],
): EpochOptions | null {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return null;
  }
  const [subcommand, ...rest] = args;
  if (subcommand === "render") return parseRenderOptions(rest);
  if (subcommand === "analyze") return parseAnalyzeOptions(rest);
  if (subcommand === "record") return parseRecordOptions(rest);
  throw new Error(`Unknown subcommand: ${subcommand}`);
}
