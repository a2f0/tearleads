/**
 * Rewrites the recorded TLC durations that order the protocol checks' runs,
 * from the output of those checks: a CI `Protocol models (...)` job log, or
 * the output of `bun run check:protocol-models` or
 * `check:protocol-negative-controls`. A duration in the logs replaces the
 * recorded one, a key the logs do not mention keeps its entry, and a key that
 * is no longer registered is dropped.
 *
 *   bun run generate:protocol-durations <log>...
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkArguments } from "../lib/checkRoot";
import { NEGATIVE_CONTROLS } from "./protocolNegativeControls";
import {
  CONTROL_DURATIONS_PATH,
  durationsFromCheckOutput,
  formatTlcDurations,
  MODEL_DURATIONS_PATH,
  parseTlcDurations,
} from "./tlcDurations";

function header(check: string): string[] {
  return [
    `Seconds each run took in ${check}, longest first.`,
    "The check starts its runs in this order, and any run with no entry",
    "before them; only the order matters. Regenerate with",
    "bun run generate:protocol-durations <log>...",
  ];
}

const { root, args: logs } = checkArguments();
if (logs.length === 0) {
  console.error("Error: pass protocol check output or CI job logs to read.");
  process.exit(1);
}

const measured = logs.map((log) =>
  durationsFromCheckOutput(readFileSync(log, "utf8")),
);
const registeredModels = new Set(
  readFileSync(join(root, "formal/protocol-models.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#")),
);
const registeredControls = new Set(NEGATIVE_CONTROLS.map(({ id }) => id));

function update(
  path: string,
  lines: readonly string[],
  registered: ReadonlySet<string>,
  updates: readonly ReadonlyMap<string, number>[],
): void {
  const file = join(root, path);
  const recorded = existsSync(file)
    ? parseTlcDurations(readFileSync(file, "utf8"), path)
    : new Map<string, number>();
  const merged = new Map(
    [...recorded, ...updates.flatMap((durations) => [...durations])].filter(
      ([key]) => registered.has(key),
    ),
  );
  writeFileSync(file, formatTlcDurations(lines, merged));
  const updated = updates.reduce(
    (count, durations) => count + durations.size,
    0,
  );
  console.log(`${path}: ${merged.size} entries, ${updated} measured.`);
}

update(
  MODEL_DURATIONS_PATH,
  header("check:protocol-models"),
  registeredModels,
  measured.map(({ models }) => models),
);
update(
  CONTROL_DURATIONS_PATH,
  header("check:protocol-negative-controls"),
  registeredControls,
  measured.map(({ controls }) => controls),
);
