// The root package's postinstall. After `bun install`, it installs the tracked
// Git hooks in a checkout that has none of them, so a fresh clone gets the
// push gate without a separate setup step.
//
// It never replaces installed hooks: they can come from a newer branch, and
// reinstalling from an older one can restore a hook that predates a push-gate
// guard. Installed hooks that differ from this branch's, and hooks that block
// an install, get a warning instead. It never fails the install; CI, a copy
// without its own Git directory, and an install without agent-tool skip it.

import { existsSync } from "node:fs";
import { join } from "node:path";

interface HooksCheck {
  ok: boolean;
  configure?: boolean;
  changes: { target: string; status: string }[];
  blockers: string[];
}

type Plan =
  | { status: "current" }
  | { status: "install"; hooks: string[] }
  | { status: "differs" }
  | { status: "blocked"; reasons: string[] }
  | { status: "unchecked" };

const root = join(import.meta.dir, "../..");
const guide = "docs/developer/static-analysis.md#ci-and-the-push-gate";
const installer = "sh scripts/git/install-hooks.sh";

function run(cmd: string[], env: Record<string, string | undefined>) {
  return Bun.spawnSync({ cmd, cwd: root, env, stdout: "pipe", stderr: "pipe" });
}

/** The caller's environment without Git variables that pin another checkout. */
function checkoutEnv(): Record<string, string | undefined> {
  const local = new Set(
    run(["git", "rev-parse", "--local-env-vars"], process.env)
      .stdout.toString()
      .split("\n"),
  );
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !local.has(name)),
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function isChange(value: unknown): value is HooksCheck["changes"][number] {
  if (!isRecord(value)) return false;
  const { target, status } = value;
  return typeof target === "string" && typeof status === "string";
}

function isHooksCheck(value: unknown): value is HooksCheck {
  if (!isRecord(value)) return false;
  const { ok, configure, changes, blockers } = value;
  return (
    typeof ok === "boolean" &&
    (configure === undefined || typeof configure === "boolean") &&
    Array.isArray(changes) &&
    changes.every(isChange) &&
    Array.isArray(blockers) &&
    blockers.every((blocker) => typeof blocker === "string")
  );
}

function parseCheck(output: string): HooksCheck | null {
  try {
    const check: unknown = JSON.parse(output);
    return isHooksCheck(check) ? check : null;
  } catch {
    return null;
  }
}

function planFor(check: HooksCheck | null): Plan {
  if (!check) return { status: "unchecked" };
  if (check.ok) return { status: "current" };
  if (check.blockers.length) {
    return { status: "blocked", reasons: check.blockers };
  }
  if (check.configure) {
    return {
      status: "blocked",
      reasons: [
        "core.hooksPath in your Git configuration names another directory; sh scripts/git/install-hooks.sh would override it for this checkout.",
      ],
    };
  }
  const fresh =
    check.changes.length > 0 &&
    check.changes.every((change) => change.status === "create");
  return fresh
    ? { status: "install", hooks: check.changes.map((change) => change.target) }
    : { status: "differs" };
}

function warn(message: string, details: string[] = []): void {
  console.error(
    [
      `warning: ${message} (${guide}).`,
      ...details.map((line) => `  ${line}`),
    ].join("\n"),
  );
}

function report(plan: Plan, install: () => boolean): void {
  switch (plan.status) {
    case "current":
      return;
    case "install":
      if (install()) {
        console.log(`Installed the Git hooks (${plan.hooks.join(", ")}).`);
      } else {
        warn(`installing the Git hooks failed; run ${installer} to see why`);
      }
      return;
    case "differs":
      warn(
        `the installed Git hooks differ from this branch's and were left as they are; once the branch includes the latest main, run ${installer}`,
      );
      return;
    case "blocked":
      warn("the Git hooks were left as they are", plan.reasons);
      return;
    case "unchecked":
      warn("could not check the Git hooks; run bun run agent-tool hooks check");
  }
}

/** True when CI is set to anything but empty, 0, or false. */
function inCi(): boolean {
  const { CI = "" } = process.env;
  return !["", "0", "false"].includes(CI.toLowerCase());
}

function main(): void {
  if (inCi()) return;
  if (!existsSync(join(root, ".git"))) return;
  if (!existsSync(join(root, "node_modules/@a2f0/agent-tool/package.json"))) {
    return;
  }
  const env = checkoutEnv();
  const agentTool = (...args: string[]) =>
    run([process.execPath, "run", "--silent", "agent-tool", ...args], env);
  const check = parseCheck(agentTool("hooks", "check").stdout.toString());
  report(
    planFor(check),
    () => agentTool("hooks", "install", "--apply").exitCode === 0,
  );
}

try {
  main();
} catch {
  warn("could not check the Git hooks; run bun run agent-tool hooks check");
}
