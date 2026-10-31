import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const script = "packages/api/scripts/deployApiMaintenance.sh";

async function writeExecutable(path: string, source: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, source);
  await chmod(path, 0o755);
}

/**
 * Runs deployApiMaintenance.sh with stubbed Git, Wrangler, curl, and sleep.
 * `answers` is the header block each successive curl call prints.
 */
async function runMaintenance(
  tier: string,
  options: {
    readonly authorization?: string;
    readonly answers?: readonly string[];
  } = {},
) {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-api-maintenance-"));
  const log = resolve(root, "calls.log");
  const record = (line: string) => `printf '%s\\n' "${line}" >> "$T_LOG"`;
  try {
    for (const path of [script, "terraform/scripts/teardownGuard.sh"]) {
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await cp(resolve(repoRoot, path), resolve(root, path));
    }
    await writeExecutable(
      resolve(root, "terraform/scripts/common.sh"),
      [
        `load_secrets_env() { ${record("secrets|$1")}; TF_VAR_domain=example.test; }`,
        'validate_domain_env() { [ -n "$TF_VAR_domain" ]; }',
        `export_wrangler_env() { ${record("wrangler-env")}; }`,
        'tier_api_hostname() { case "$1" in prod) echo "api.$TF_VAR_domain" ;; *) echo "api-$1.$TF_VAR_domain" ;; esac; }',
      ].join("\n"),
    );
    await writeExecutable(
      resolve(root, "bin/git"),
      '#!/bin/sh\nprintf "%s\\n" "$T_ROOT"\n',
    );
    await writeExecutable(
      resolve(root, "bin/bunx"),
      `#!/bin/sh\n${record('bunx|$(basename "$PWD")|$*')}\n`,
    );
    await writeExecutable(
      resolve(root, "bin/sleep"),
      `#!/bin/sh\n${record("sleep|$*")}\n`,
    );
    const answers = options.answers ?? [];
    for (const [index, answer] of answers.entries()) {
      await Bun.write(resolve(root, `answer-${index}`), answer);
    }
    await writeExecutable(
      resolve(root, "bin/curl"),
      [
        "#!/bin/sh",
        'n=$(cat "$T_ROOT/curl-count" 2>/dev/null || echo 0)',
        'echo $((n + 1)) > "$T_ROOT/curl-count"',
        `${record("curl|$*")}`,
        '[ -f "$T_ROOT/answer-$n" ] || exit 7',
        'cat "$T_ROOT/answer-$n"',
      ].join("\n"),
    );
    const child = Bun.spawn(["bash", resolve(root, script), tier], {
      cwd: root,
      env: {
        PATH: `${root}/bin:/usr/bin:/bin`,
        T_ROOT: root,
        T_LOG: log,
        ...(options.authorization
          ? { TEARLEADS_TEARDOWN_TIER: options.authorization }
          : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const calls = (await readFile(log, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean);
    return { exitCode, stdout, stderr, calls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const maintenanceAnswer =
  "HTTP/2 503\r\nretry-after: 120\r\nX-Tearleads-Maintenance: reset\r\n\r\n";
const apiAnswer = "HTTP/2 200\r\ncontent-type: application/json\r\n\r\n";

for (const authorization of ["", "staging"]) {
  test(`refuses production ${authorization ? "authorized for staging" : "without authorization"}`, async () => {
    const result = await runMaintenance("prod", {
      authorization,
      answers: [maintenanceAnswer],
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Production is destroyed only through scripts/deploy/destroyProduction.sh",
    );
    expect(result.calls).toEqual([]);
  });
}

const probe =
  "curl|-sS --max-time 10 -o /dev/null -D - https://api.example.test/";
// A Cron invocation may run 15 minutes, plus 30 s of waitUntil work.
const drain = "sleep|930";

test("publishes the maintenance Worker, waits for it, then drains old invocations", async () => {
  const result = await runMaintenance("prod", {
    authorization: "prod",
    answers: [apiAnswer, apiAnswer, maintenanceAnswer],
  });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toEqual([
    "secrets|prod",
    "wrangler-env",
    "bunx|api|--no-install wrangler deploy --config wrangler.maintenance.jsonc --env prod",
    probe,
    "sleep|2",
    probe,
    "sleep|2",
    probe,
    drain,
  ]);
  expect(result.stdout).toContain("API maintenance is live (prod)");
});

test("staging needs no production authorization", async () => {
  const result = await runMaintenance("staging", {
    answers: [maintenanceAnswer],
  });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toContain(
    "bunx|api|--no-install wrangler deploy --config wrangler.maintenance.jsonc --env staging",
  );
  expect(result.calls.slice(-2)).toEqual([
    "curl|-sS --max-time 10 -o /dev/null -D - https://api-staging.example.test/",
    drain,
  ]);
});

test("fails when the hostname never serves the maintenance response", async () => {
  const result = await runMaintenance("staging", {
    answers: Array.from({ length: 30 }, () => apiAnswer),
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(
    "did not answer with the maintenance response",
  );
  expect(result.calls.filter((call) => call.startsWith("curl|"))).toHaveLength(
    30,
  );
  expect(result.calls).not.toContain(drain);
  expect(result.stdout).not.toContain("API maintenance is live");
});

test("rejects an unknown tier before loading credentials", async () => {
  const result = await runMaintenance("dev");
  expect(result.exitCode).toBe(1);
  expect(result.calls).toEqual([]);
});
