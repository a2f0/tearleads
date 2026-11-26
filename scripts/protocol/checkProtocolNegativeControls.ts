/**
 * Runs every registered protocol negative control: a registered model
 * configuration with one refusal rule or lock flipped away from production,
 * which TLC must reject with exactly the named invariant, action property,
 * or temporal violation. A control that passes, or fails some other way,
 * fails `check:fast`, so a rule that stops carrying its invariant, or an
 * invariant that has become vacuous, is caught on every push.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { checkRoot } from "../lib/checkRoot";
import { runFailFastPool } from "./failFastPool";
import {
  NEGATIVE_CONTROLS,
  parseConfig,
  renderNegativeControlConfig,
  violationPattern,
} from "./protocolNegativeControls";
import type { NegativeControl } from "./protocolNegativeControlTypes";
import {
  CONTROL_DURATIONS_PATH,
  longestFirst,
  parseTlcDurations,
  registeredDurations,
  staleDurationsNote,
} from "./tlcDurations";
import { resolveTlcTools, runTlcAsync, tlcParallelism } from "./tlcTools";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/** Every control derives from a pair the pull-request registry checks. */
function assertBaseIsRegistered(root: string, control: NegativeControl): void {
  const registry = readFileSync(
    join(root, "formal/protocol-models.txt"),
    "utf8",
  )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (!registry.includes(`${control.module}|${control.config}`)) {
    fail(
      `${control.id} derives from ${control.module}|${control.config}, which formal/protocol-models.txt does not register.`,
    );
  }
}

/** Returns why the control failed, or undefined when TLC rejected it as expected. */
async function runControl(
  root: string,
  tools: ReturnType<typeof resolveTlcTools>,
  control: NegativeControl,
  overlappingRuns: number,
): Promise<string | undefined> {
  const base = parseConfig(readFileSync(join(root, control.config), "utf8"));
  const rendered = renderNegativeControlConfig(base, control);
  const workDirectory = mkdtempSync(join(tmpdir(), "tearleads-negative-"));
  try {
    const modulePath = join(workDirectory, basename(control.module));
    const configPath = join(workDirectory, `${control.id}.cfg`);
    writeFileSync(modulePath, readFileSync(join(root, control.module)));
    writeFileSync(configPath, rendered);
    const started = performance.now();
    const result = await runTlcAsync(tools, {
      configPath,
      cwd: workDirectory,
      libraryPath: join(root, dirname(control.module)),
      modulePath,
      overlappingRuns,
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    if (result.ok) {
      return `${control.id} passed TLC; the ${control.expect.kind} ${control.expect.name} no longer depends on the flipped rule:\n${result.output}`;
    }
    if (!violationPattern(control.expect).test(result.output)) {
      return `${control.id} failed TLC, but not with the expected ${control.expect.kind} ${control.expect.name}:\n${result.output}`;
    }
    console.log(
      `${control.id}: TLC reported ${control.expect.kind} ${control.expect.name} violated, as expected (${seconds}s).`,
    );
    return undefined;
  } finally {
    rmSync(workDirectory, { force: true, recursive: true });
  }
}

const root = checkRoot();
const tools = resolveTlcTools(root);
const ids = new Set<string>();
for (const control of NEGATIVE_CONTROLS) {
  if (ids.has(control.id)) {
    fail(`negative control id ${control.id} is registered twice.`);
  }
  ids.add(control.id);
  assertBaseIsRegistered(root, control);
}

/** Recorded durations, which start the longest controls first. */
function recordedDurations(): Map<string, number> {
  const path = join(root, CONTROL_DURATIONS_PATH);
  if (!existsSync(path)) {
    return new Map();
  }
  let durations: Map<string, number>;
  try {
    durations = parseTlcDurations(
      readFileSync(path, "utf8"),
      CONTROL_DURATIONS_PATH,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const registered = registeredDurations(durations, ids);
  if (registered.stale.length > 0) {
    console.log(
      staleDurationsNote(
        CONTROL_DURATIONS_PATH,
        "the negative-control registry",
        registered.stale,
      ),
    );
  }
  return registered.durations;
}

// Overlapped runs finish in completion order, so progress lines interleave.
const parallelism = tlcParallelism();
const failures = await runFailFastPool(
  longestFirst(NEGATIVE_CONTROLS, recordedDurations(), (control) => control.id),
  parallelism,
  (control) => runControl(root, tools, control, parallelism),
  (control) => control.id,
);
if (failures.length > 0) {
  fail(failures.join("\n\n"));
}
console.log(
  `Checked ${NEGATIVE_CONTROLS.length} protocol negative control(s).`,
);
