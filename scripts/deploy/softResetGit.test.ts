import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./softReset.testUtils";

function gitFixture() {
  const f = fixture();
  const called = join(f.root, "fsmonitor-called");
  const hook = join(f.root, "fsmonitor-hook");
  const calls = join(f.root, "git-args.jsonl");
  writeFileSync(
    hook,
    `#!/bin/sh\nprintf invoked >> '${called}'\nprintf 'fixture-token\\0'\n`,
    { mode: 0o755 },
  );
  // ResetRun strips GIT_*; use this synthetic HOME's global config instead.
  writeFileSync(join(f.home, ".gitconfig"), `[core]\n\tfsmonitor = ${hook}\n`);
  writeFileSync(
    join(f.root, "git.ts"),
    `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
const result = Bun.spawnSync(["/usr/bin/git", ...args], { env: process.env });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.exitCode);
`,
  );
  writeFileSync(
    join(f.root, "bin/git"),
    `#!/bin/sh\nexec '${process.execPath}' '${f.root}/git.ts' "$@"\n`,
    { mode: 0o755 },
  );
  const baseline = Bun.spawnSync(["/usr/bin/git", "status", "--porcelain"], {
    cwd: f.repo,
    env: f.env,
  });
  expect(baseline.exitCode).toBe(0);
  expect(existsSync(called)).toBe(true);
  rmSync(called);
  return {
    ...f,
    called,
    args: () =>
      readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
  };
}

test("reset source probes override inherited fsmonitor without changing the user's config", () => {
  const f = gitFixture();
  try {
    const driver = join(f.root, "source.ts");
    writeFileSync(
      driver,
      `
import { ResetRun } from ${JSON.stringify(join(f.repo, "scripts/deploy/softResetRuntime.ts"))};
const run = new ResetRun(${JSON.stringify(f.repo)}, "prod");
try { await run.source(); } finally { await run.finish(false); }
`,
    );
    const result = Bun.spawnSync([process.execPath, driver], {
      cwd: f.repo,
      env: f.env,
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(existsSync(f.called)).toBe(false);
    expect(f.args()).toEqual([
      ["-c", "core.fsmonitor=false", "rev-parse", "HEAD"],
      [
        "-c",
        "core.fsmonitor=false",
        "status",
        "--porcelain",
        "--untracked-files=all",
      ],
      ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"],
    ]);
    expect(readFileSync(join(f.home, ".gitconfig"), "utf8")).toContain(
      "fsmonitor-hook",
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("API checkout source check disables the synthetic global fsmonitor hook", () => {
  const f = gitFixture();
  try {
    const driver = join(f.root, "check.sh");
    writeFileSync(driver, '. "$1"\napi_checkout_is_clean "$2"\n');
    const result = Bun.spawnSync(
      [
        "/bin/bash",
        driver,
        join(import.meta.dir, "../../packages/api/scripts/sentryBuild.sh"),
        f.repo,
      ],
      { cwd: f.repo, env: f.env },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(existsSync(f.called)).toBe(false);
    expect(f.args()).toEqual([
      ["-c", "core.fsmonitor=false", "-C", f.repo, "status", "--porcelain"],
    ]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("API build source probes all disable inherited fsmonitor", () => {
  const f = gitFixture();
  try {
    writeFileSync(
      join(f.root, "bin/bun"),
      '#!/bin/sh\ncase "$1" in scripts/workerDefines.ts) printf "DEFINE:value\\n" ;; run) ;; *) exit 1 ;; esac\n',
    );
    writeFileSync(
      join(f.root, "bin/bunx"),
      '#!/bin/sh\nwhile [ "$1" != --outdir ]; do shift; done\nshift\nmkdir -p "$1"\nprintf bundle > "$1/index.js"\nprintf map > "$1/index.js.map"\n',
    );
    const driver = join(f.root, "build.sh");
    writeFileSync(
      driver,
      '. "$1"\nAPI_SENTRY_DSN=fixture\nbuild_api_worker "$2" prod unused "$3"\n',
    );
    const result = Bun.spawnSync(
      [
        "/bin/bash",
        driver,
        join(import.meta.dir, "../../packages/api/scripts/sentryBuild.sh"),
        f.repo,
        join(f.root, "out"),
      ],
      { cwd: f.repo, env: f.env },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(existsSync(f.called)).toBe(false);
    const prefix = ["-c", "core.fsmonitor=false", "-C", f.repo];
    expect(f.args()).toEqual([
      [...prefix, "rev-parse", "HEAD"],
      [...prefix, "status", "--porcelain"],
      [...prefix, "rev-parse", "HEAD"],
      [...prefix, "status", "--porcelain"],
    ]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("preflight root probe explicitly disables fsmonitor", () => {
  const f = gitFixture();
  try {
    const result = Bun.spawnSync(
      [
        "/bin/bash",
        join(f.repo, "scripts/deploy/softResetPreflight.sh"),
        "prod",
        "credentials",
      ],
      { cwd: f.repo, env: f.env },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(f.args()).toEqual([
      ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"],
    ]);
    expect(existsSync(f.called)).toBe(false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("API diagnostics index probe disables inherited fsmonitor", () => {
  const f = gitFixture();
  try {
    const driver = join(f.root, "diagnostics.ts");
    writeFileSync(
      driver,
      `
import { diagnosticsBuild, apiBuildVersion } from ${JSON.stringify(join(import.meta.dir, "../../packages/api/scripts/diagnosticsBuild.ts"))};
console.log(JSON.stringify({ build: diagnosticsBuild(${JSON.stringify(f.repo)}), version: apiBuildVersion(${JSON.stringify(f.repo)}) }));
`,
    );
    const result = Bun.spawnSync([process.execPath, driver], {
      cwd: f.repo,
      env: f.env,
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const data = JSON.parse(result.stdout.toString());
    expect(data.build.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(data.version).toBe(1);
    expect(existsSync(f.called)).toBe(false);
    expect(f.args()).toEqual([
      ["-c", "core.fsmonitor=false", "rev-parse", "HEAD"],
      ["-c", "core.fsmonitor=false", "ls-files", "-z", "packages"],
      ["-c", "core.fsmonitor=false", "rev-parse", "--is-shallow-repository"],
      ["-c", "core.fsmonitor=false", "rev-list", "--count", "HEAD"],
    ]);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("metadata-only sibling Git probes do not invoke the fsmonitor hook", () => {
  const f = gitFixture();
  try {
    // These are the other Git verbs in the reset's transitive source readers.
    for (const args of [
      ["rev-parse", "HEAD"],
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "--is-shallow-repository"],
      ["rev-list", "--count", "HEAD"],
    ]) {
      const result = Bun.spawnSync(["/usr/bin/git", ...args], {
        cwd: f.repo,
        env: f.env,
      });
      expect(result.exitCode, JSON.stringify(args)).toBe(0);
      expect(existsSync(f.called), JSON.stringify(args)).toBe(false);
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
