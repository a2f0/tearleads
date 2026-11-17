import { expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pushedRanges } from "../lintPushedSourceShape";
import { cleanSource, fixture, suppressedSource } from "./fixture.testUtils";

const repoRoot = resolve(import.meta.dir, "../../..");
const pushedSourceShape = join(
  repoRoot,
  "scripts/checks/lintPushedSourceShape.ts",
);
const modelCommands = [
  "run check:protocol-models",
  "run check:protocol-negative-controls",
];

interface PushGateCheck {
  ok: boolean;
  hook: {
    path: string;
    tracked: boolean;
    canonical: boolean | null;
    installed: boolean;
  };
  pushGate: { declared: boolean };
  steps: { label: string; command: string[]; allowSlow: string | null }[];
  errors: string[];
}

function pushGateCheck(): PushGateCheck {
  const result = Bun.spawnSync(
    [process.execPath, "node_modules/.bin/agent-tool", "push-gate", "check"],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  return JSON.parse(result.stdout.toString()) as PushGateCheck;
}

test("the tracked pre-push hook is agent-tool's push gate, with only static steps", () => {
  const check = pushGateCheck();
  expect(check.errors).toEqual([]);
  expect(check.ok).toBe(true);
  // push-gate check reads only tracked files: `installed` means agent-tool.json's
  // hooks.files installs the hook as an executable pre-push, not that
  // .git/hooks holds a copy, so a fresh CI checkout passes too.
  expect(check.hook).toEqual({
    path: "scripts/git/hooks/pre-push",
    tracked: true,
    canonical: true,
    installed: true,
  });
  expect(check.pushGate.declared).toBe(true);
  // Tests, builds, and installs belong to CI, never to an exception here.
  expect(check.steps.filter(({ allowSlow }) => allowSlow !== null)).toEqual([]);
});

test("CI's check:fast runs every check the push gate runs", async () => {
  const scripts = (await Bun.file(join(repoRoot, "package.json")).json())
    .scripts as Record<string, string>;
  const runs = (body: string) =>
    [...body.matchAll(/bun run ([\w:-]+)/g)].map(([, name]) => name ?? "");
  const fast = runs(
    readFileSync(join(repoRoot, "scripts/checks/fastChecks.sh"), "utf8"),
  );
  // One level of package scripts: `lint:biome` runs `lint:biome:check`.
  const covered = new Set([
    ...fast,
    ...fast.flatMap((name) => runs(scripts[name] ?? "")),
  ]);
  // The gate checks the pushed commits; check:fast scans the whole tree.
  const sameCheck: Record<string, string> = {
    "scripts/checks/lintPushedSourceShape.ts": "lint:source-shape",
  };
  for (const { label, command } of pushGateCheck().steps) {
    const [, verb = "", target = ""] = command;
    const script = verb === "run" ? target : sameCheck[verb];
    expect(script, label).toBeDefined();
    expect(covered.has(script ?? ""), label).toBe(true);
  }
  // Too slow for the gate, so CI's Lint job is the only automatic run.
  expect(fast).toContain("lint:architecture");
});

function stubFixture() {
  const repo = fixture();
  for (const path of [
    "scripts/git/hooks/pre-commit",
    "scripts/checks/checkFast.sh",
    "scripts/checks/fastChecks.sh",
    "scripts/lib/stepTimings.sh",
  ]) {
    repo.write(path, readFileSync(join(repoRoot, path), "utf8"));
    chmodSync(join(repo.cwd, path), 0o755);
  }
  repo.write(
    "bin/bun",
    "#!/bin/sh\n" +
      'printf "%s\\n" "$*" >> "$COMMAND_LOG"\n' +
      '[ "$*" != "$FAILING_COMMAND" ] || exit 23\n',
  );
  chmodSync(join(repo.cwd, "bin/bun"), 0o755);
  repo.commit();
  const log = join(repo.cwd, "commands.log");
  const { PATH = "" } = process.env;
  const run = (
    extra: Record<string, string>,
    failing: string,
    ...cmd: string[]
  ) =>
    Bun.spawnSync(cmd, {
      cwd: repo.cwd,
      env: {
        ...repo.env,
        // Lint exports this for its own check:fast; fixtures choose their own.
        CI_DEFER_PROTOCOL_MODELS: "",
        PATH: `${join(repo.cwd, "bin")}:${PATH}`,
        COMMAND_LOG: log,
        FAILING_COMMAND: failing,
        ...extra,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  return { ...repo, log, run };
}

test("check:fast runs the model passes unless CI defers them to their own job", () => {
  const repo = stubFixture();
  try {
    const local = repo.run({}, "", "sh", "scripts/checks/checkFast.sh");
    expect(local.exitCode, local.stderr.toString()).toBe(0);
    const commands = readFileSync(repo.log, "utf8");
    for (const command of modelCommands) expect(commands).toContain(command);
    expect(commands).toContain("run lint:openapi:compatibility\n");
    expect(commands).toContain("run lint:infrastructure-parity\n");

    repo.write("commands.log", "");
    const deferred = repo.run(
      { CI_DEFER_PROTOCOL_MODELS: "1" },
      "",
      "sh",
      "scripts/checks/checkFast.sh",
    );
    expect(deferred.exitCode, deferred.stderr.toString()).toBe(0);
    const ci = readFileSync(repo.log, "utf8");
    for (const command of modelCommands) {
      expect(ci).not.toContain(`${command}\n`);
    }
    expect(ci).toContain("run check:protocol-traces\n");
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test("check:fast stops at the first failing check", () => {
  const repo = stubFixture();
  try {
    const result = repo.run(
      {},
      "run lint:markdown",
      "sh",
      "scripts/checks/checkFast.sh",
    );
    expect(result.exitCode).toBe(23);
    expect(readFileSync(repo.log, "utf8")).not.toContain("run lint:doc-links");
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test("detached commits skip only branch naming", () => {
  const repo = stubFixture();
  try {
    const attached = repo.run(
      {},
      "run lint:branch-name",
      "sh",
      "scripts/git/hooks/pre-commit",
    );
    expect(attached.exitCode).toBe(23);
    repo.git("checkout", "--detach");
    repo.write("commands.log", "");
    const detached = repo.run(
      {},
      "run lint:branch-name",
      "sh",
      "scripts/git/hooks/pre-commit",
    );
    expect(detached.exitCode, detached.stderr.toString()).toBe(0);
    const commands = readFileSync(repo.log, "utf8");
    expect(commands).not.toContain("run lint:branch-name");
    expect(commands).toContain("run lint:files");
    expect(commands).toContain("lintSourceShape.ts --staged");
    expect(commands).toContain("run agent-tool checks binaries --staged");
    expect(commands).toContain("run lint-staged");
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

const pushedRef = (
  remoteRef: string,
  localOid: string,
  base: string | null,
  commits = [localOid],
) => ({ remoteRef, localOid, deleted: false, commits, base });

test("the source-shape step checks each pushed ref from its base", () => {
  const none = () => null;
  expect(
    pushedRanges(
      {
        schemaVersion: 1,
        refs: [
          pushedRef("refs/heads/a", "a1", "a0"),
          // A deletion, or an existing commit under a new name, adds nothing.
          { ...pushedRef("refs/heads/gone", "0", null), deleted: true },
          pushedRef("refs/heads/alias", "a1", "a0", []),
          pushedRef("refs/heads/new", "n1", null),
        ],
      },
      (tip) => (tip === "n1" ? "m0" : null),
    ),
  ).toEqual([
    { ref: "refs/heads/a", range: "a0..a1" },
    { ref: "refs/heads/new", range: "m0..n1" },
  ]);
  expect(
    pushedRanges(
      { schemaVersion: 1, refs: [pushedRef("refs/heads/x", "x1", null)] },
      none,
    ),
  ).toEqual([{ ref: "refs/heads/x", range: null }]);
  expect(() => pushedRanges({ schemaVersion: 2, refs: [] }, none)).toThrow(
    "Unsupported push data schema 2",
  );
});

test("the source-shape step refuses pushed commits that break the shape", async () => {
  const repo = fixture();
  try {
    // Work off a branch other than main, so main exists only when a case
    // creates it.
    repo.git("checkout", "-q", "-b", "work");
    const root = repo.commit();
    repo.write("src/clean.ts", cleanSource);
    const clean = repo.commit();
    repo.write("src/suppressed.ts", suppressedSource);
    const suppressed = repo.commit();
    const step = async (refs: unknown[]) => {
      const file = join(repo.cwd, "push.json");
      await Bun.write(file, JSON.stringify({ schemaVersion: 1, refs }));
      const result = Bun.spawnSync([process.execPath, pushedSourceShape], {
        cwd: repo.cwd,
        env: { ...repo.env, AGENT_TOOL_PUSH_GATE: file },
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        code: result.exitCode,
        output: result.stdout.toString() + result.stderr.toString(),
      };
    };

    const passed = await step([pushedRef("refs/heads/ok", clean, root)]);
    expect(passed.code, passed.output).toBe(0);
    expect(passed.output).toContain(`for ${root}..${clean}`);

    const failed = await step([pushedRef("refs/heads/bad", suppressed, clean)]);
    expect(failed.code).not.toBe(0);
    expect(failed.output).toContain("src/suppressed.ts");

    // Without a base, the step compares against where the push left main.
    const unanchored = [pushedRef("refs/heads/bad", suppressed, null)];
    const skipped = await step(unanchored);
    expect(skipped.code, skipped.output).toBe(0);
    expect(skipped.output).toContain("no base to compare against");
    repo.git("update-ref", "refs/heads/main", clean);
    const fallback = await step(unanchored);
    expect(fallback.code).not.toBe(0);
    expect(fallback.output).toContain(`for ${clean}..${suppressed}`);
  } finally {
    rmSync(repo.cwd, { recursive: true, force: true });
  }
});

test("the source-shape step runs only inside the push gate", () => {
  const result = Bun.spawnSync([process.execPath, pushedSourceShape], {
    cwd: repoRoot,
    env: { ...process.env, AGENT_TOOL_PUSH_GATE: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("AGENT_TOOL_PUSH_GATE is unset");
});
