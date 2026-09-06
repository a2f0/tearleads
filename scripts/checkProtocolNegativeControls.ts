/**
 * Runs every registered protocol negative control: a registered model
 * configuration with one refusal rule or lock flipped away from production,
 * which TLC must reject with exactly the named invariant, action property,
 * or temporal violation. A control that passes, or fails some other way,
 * fails `check:fast`, so a rule that stops carrying its invariant, or an
 * invariant that has become vacuous, is caught on every push.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  NEGATIVE_CONTROLS,
  type NegativeControl,
  parseConfig,
  renderNegativeControlConfig,
  violationPattern,
} from "./protocolNegativeControls";
import { resolveTlcTools, runTlc } from "./tlcTools";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function repoRoot(): string {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail("the negative-control check must run inside a Git repository.");
  }
  return result.stdout.trim();
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

function runControl(
  root: string,
  tools: ReturnType<typeof resolveTlcTools>,
  control: NegativeControl,
): void {
  assertBaseIsRegistered(root, control);
  const base = parseConfig(readFileSync(join(root, control.config), "utf8"));
  const rendered = renderNegativeControlConfig(base, control);
  const workDirectory = mkdtempSync(join(tmpdir(), "tearleads-negative-"));
  try {
    const modulePath = join(workDirectory, basename(control.module));
    const configPath = join(workDirectory, `${control.id}.cfg`);
    writeFileSync(modulePath, readFileSync(join(root, control.module)));
    writeFileSync(configPath, rendered);
    const result = runTlc(tools, {
      configPath,
      cwd: workDirectory,
      libraryPath: join(root, dirname(control.module)),
      modulePath,
    });
    if (result.ok) {
      fail(
        `${control.id} passed TLC; the ${control.expect.kind} ${control.expect.name} no longer depends on the flipped rule:\n${result.output}`,
      );
    }
    if (!violationPattern(control.expect).test(result.output)) {
      fail(
        `${control.id} failed TLC, but not with the expected ${control.expect.kind} ${control.expect.name}:\n${result.output}`,
      );
    }
    console.log(
      `${control.id}: TLC reported ${control.expect.kind} ${control.expect.name} violated, as expected.`,
    );
  } finally {
    rmSync(workDirectory, { force: true, recursive: true });
  }
}

const root = repoRoot();
const tools = resolveTlcTools(root);
const ids = new Set<string>();
for (const control of NEGATIVE_CONTROLS) {
  if (ids.has(control.id)) {
    fail(`negative control id ${control.id} is registered twice.`);
  }
  ids.add(control.id);
  runControl(root, tools, control);
}
console.log(
  `Checked ${NEGATIVE_CONTROLS.length} protocol negative control(s).`,
);
