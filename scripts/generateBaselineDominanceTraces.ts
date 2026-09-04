/**
 * Regenerates formal/document-sync/BaselineDominanceTraces.json — the
 * deterministic TLC trace fixture for the BaselineDominance model — by running
 * the registered BaselineDominanceTraceExport configuration and
 * canonicalizing its exported behaviors. `--check` verifies the committed
 * fixture matches instead of writing it. The TypeScript replay suite
 * (packages/api/src/documents/documentBaselineDominanceTraceReplay.test.ts)
 * drives the fixture through the real dominance and redirect kernels.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { resolveTlcTools, runTlc } from "./tlcTools";

const EXPORT_MODULE = "formal/document-sync/BaselineDominanceTraceExport.tla";
const EXPORT_CONFIG = "formal/document-sync/BaselineDominanceTraceExport.cfg";
const FIXTURE_PATH = "formal/document-sync/BaselineDominanceTraces.json";
const EXPECTED_BEHAVIOR_COUNT = 2048;
const EXPORT_BOUNDS = {
  maxCounter: 1,
  maxEpoch: 2,
  peers: 2,
  updateCount: 2,
} as const;

interface ExportedBehavior {
  readonly coverage: readonly [number, number];
  readonly currentEpoch: number;
  readonly dominated: readonly [boolean, boolean];
  readonly hasBaseline: boolean;
  readonly historyMode: "normal" | "raw";
  readonly served: readonly [boolean, boolean];
  readonly updates: readonly [
    { readonly epoch: number; readonly frontier: readonly [number, number] },
    { readonly epoch: number; readonly frontier: readonly [number, number] },
  ];
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function repoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail("the trace generator must run inside a Git repository.");
  }
  return result.stdout.trim();
}

function runTraceExport(root: string): string {
  const result = runTlc(resolveTlcTools(root), {
    configPath: EXPORT_CONFIG,
    cwd: root,
    modulePath: EXPORT_MODULE,
  });
  if (!result.ok) {
    fail(
      `TLC did not complete cleanly for ${EXPORT_MODULE}:\n${result.output}`,
    );
  }
  return result.output;
}

function parseScalar(token: string): boolean | number | string {
  if (token === "TRUE") {
    return true;
  }
  if (token === "FALSE") {
    return false;
  }
  if (/^-?\d+$/.test(token)) {
    return Number(token);
  }
  const quoted = token.match(/^"(.*)"$/);
  if (quoted) {
    return quoted[1] ?? "";
  }
  fail(`unparseable exported scalar: ${token}`);
}

function requireNumber(
  value: boolean | number | string,
  label: string,
): number {
  if (typeof value !== "number") {
    fail(`${label} is not a number in an exported behavior.`);
  }
  return value;
}

function requireBoolean(
  value: boolean | number | string,
  label: string,
): boolean {
  if (typeof value !== "boolean") {
    fail(`${label} is not a boolean in an exported behavior.`);
  }
  return value;
}

function parseBehavior(tuple: string): ExportedBehavior {
  const inner = tuple
    .replace(/^<<\s*/, "")
    .replace(/\s*>>$/, "")
    .split(",")
    .map((token) => parseScalar(token.trim()));
  if (inner.length !== 16 || inner[0] !== "BDTRACE") {
    fail(`unexpected exported tuple shape: ${tuple}`);
  }
  const historyMode = inner[3];
  if (historyMode !== "normal" && historyMode !== "raw") {
    fail(`unexpected exported history mode: ${String(historyMode)}`);
  }
  return {
    coverage: [
      requireNumber(inner[4] ?? "", "coverage[a]"),
      requireNumber(inner[5] ?? "", "coverage[b]"),
    ],
    currentEpoch: requireNumber(inner[1] ?? "", "currentEpoch"),
    dominated: [
      requireBoolean(inner[14] ?? "", "dominated[1]"),
      requireBoolean(inner[15] ?? "", "dominated[2]"),
    ],
    hasBaseline: requireBoolean(inner[2] ?? "", "hasBaseline"),
    historyMode,
    served: [
      requireBoolean(inner[12] ?? "", "served[1]"),
      requireBoolean(inner[13] ?? "", "served[2]"),
    ],
    updates: [
      {
        epoch: requireNumber(inner[6] ?? "", "updates[1].epoch"),
        frontier: [
          requireNumber(inner[7] ?? "", "updates[1].frontier[a]"),
          requireNumber(inner[8] ?? "", "updates[1].frontier[b]"),
        ],
      },
      {
        epoch: requireNumber(inner[9] ?? "", "updates[2].epoch"),
        frontier: [
          requireNumber(inner[10] ?? "", "updates[2].frontier[a]"),
          requireNumber(inner[11] ?? "", "updates[2].frontier[b]"),
        ],
      },
    ],
  };
}

function renderFixture(tlcOutput: string): string {
  const tuples = tlcOutput.match(/<<\s*"BDTRACE"[\s\S]*?>>/g) ?? [];
  const rows = new Map<string, string>();
  for (const tuple of tuples) {
    const behavior = parseBehavior(tuple.replace(/\s+/g, " "));
    rows.set(JSON.stringify(behavior), JSON.stringify(behavior));
  }
  if (rows.size !== EXPECTED_BEHAVIOR_COUNT) {
    fail(
      `expected ${EXPECTED_BEHAVIOR_COUNT} distinct exported behaviors, found ${rows.size}.`,
    );
  }
  const sortedRows = [...rows.keys()].sort((left, right) =>
    left < right ? -1 : 1,
  );
  const header = JSON.stringify(
    {
      $generated:
        "Generated by scripts/generateBaselineDominanceTraces.ts from formal/document-sync/BaselineDominanceTraceExport.tla; do not edit.",
      bounds: EXPORT_BOUNDS,
    },
    null,
    2,
  );
  return `${header.slice(0, -2)},\n  "behaviors": [\n    ${sortedRows.join(
    ",\n    ",
  )}\n  ]\n}\n`;
}

const arguments_ = process.argv.slice(2);
if (
  arguments_.length > 1 ||
  (arguments_.length === 1 && arguments_[0] !== "--check")
) {
  fail("Usage: bun scripts/generateBaselineDominanceTraces.ts [--check]");
}

const root = repoRoot();
const fixture = renderFixture(runTraceExport(root));
const fixtureFile = Bun.file(join(root, FIXTURE_PATH));

if (arguments_[0] === "--check") {
  const actual = (await fixtureFile.exists()) ? await fixtureFile.text() : null;
  if (actual !== fixture) {
    fail(
      `${FIXTURE_PATH} is stale; run \`bun run generate:protocol-traces\` and commit the result.`,
    );
  }
  console.log(`${FIXTURE_PATH} matches the exported TLC behaviors.`);
} else {
  await Bun.write(fixtureFile, fixture);
  console.log(
    `Wrote ${EXPECTED_BEHAVIOR_COUNT} exported behaviors to ${FIXTURE_PATH}.`,
  );
}
