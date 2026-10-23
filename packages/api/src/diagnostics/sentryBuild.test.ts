import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../../scripts/sentryBuild.sh", import.meta.url)
  .pathname;

async function runBuild(mode = "ok", tier = "staging") {
  const { PATH } = process.env;
  const root = await mkdtemp(join(tmpdir(), "api-sentry-build-"));
  const calls = join(root, "calls");
  const fixture = `#!/bin/bash
set -euo pipefail
case "$(basename "$0")" in
  git)
    case "$*" in
      *rev-parse*)
        if [[ "$TEST_MODE" == revision-changed && -s "$TEST_CALLS" ]]; then
          printf '%040d\\n' 2
        else printf '%040d\\n' 1; fi ;;
      *status*)
        if [[ "$TEST_MODE" == status-failure ]]; then exit 7; fi
        if [[ "$TEST_MODE" == dirty || ( "$TEST_MODE" == changed-during-build && -s "$TEST_CALLS" ) ]]; then
          echo ' M file.ts'
        fi ;;
    esac ;;
  bun)
    if [[ "$*" == scripts/workerDefines.ts ]]; then
      echo 'API_BUILD_VERSION:123'
      echo 'API_DIAGNOSTICS_BUILD:{"commit":"synthetic"}'
    else
      printf 'upload|%s\\n' "$*" >> "$TEST_CALLS"
      if [[ "$TEST_MODE" == upload-failure ]]; then exit 7; fi
    fi ;;
  bunx)
    printf 'build|%s\\n' "$*" >> "$TEST_CALLS"
    output=''
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == --outdir ]]; then output="$2"; shift; fi
      shift
    done
    mkdir -p "$output"
    echo 'synthetic bundle' > "$output/index.js"
    if [[ "$TEST_MODE" != missing-map ]]; then echo '{}' > "$output/index.js.map"; fi
    ;;
esac
`;
  try {
    for (const name of ["git", "bun", "bunx"]) {
      await writeFile(join(root, name), fixture);
      await chmod(join(root, name), 0o700);
    }
    await writeFile(calls, "");
    const child = Bun.spawn(
      [
        "bash",
        "-c",
        '. "$1"; configure_api_sentry "$3" && build_api_worker "$2" "$3" "$2/config.jsonc" "$2/bundle"',
        "bash",
        script,
        root,
        tier,
      ],
      {
        env: {
          PATH: `${root}:${PATH}`,
          TEST_MODE: mode,
          TEST_CALLS: calls,
          SENTRY_ORG: "synthetic",
          SENTRY_AUTH_TOKEN:
            mode === "missing-token" ? "" : "synthetic-private",
          SENTRY_API_STAGING_DSN:
            mode === "disabled"
              ? ""
              : `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
          SENTRY_API_PRODUCTION_DSN: `https://${"b".repeat(32)}@o1.ingest.us.sentry.io/2`,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return {
      exitCode,
      output: stdout + stderr,
      calls: await readFile(calls, "utf8"),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test.each(["staging", "prod"])(
  "%s builds before uploading the matching release and dist",
  async (tier) => {
    const result = await runBuild("ok", tier);
    expect(result.exitCode).toBe(0);
    const [build, upload] = result.calls.trim().split("\n");
    const workerConfig = Bun.JSONC.parse(
      await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8"),
    ) as { env: Record<string, { vars: { API_SENTRY_ENVIRONMENT: string } }> };
    const environment = workerConfig.env[tier]?.vars.API_SENTRY_ENVIRONMENT;
    expect(environment).toBeString();
    expect(build).toContain("--dry-run");
    expect(upload).toContain(`--project tearleads-api-${environment}`);
    expect(upload).toContain(
      `--release tearleads-api@${"1".padStart(40, "0")}`,
    );
    expect(upload).toContain(`--dist ${environment} --url-prefix app:///`);
    expect(upload).toContain("index.js.map");
    expect(result.output).not.toContain("synthetic-private");
  },
);

test.each([
  "missing-map",
  "missing-token",
  "dirty",
  "changed-during-build",
  "revision-changed",
  "status-failure",
  "upload-failure",
])("%s stops the deployment preparation", async (mode) => {
  const result = await runBuild(mode);
  expect(result.exitCode).not.toBe(0);
  if (mode !== "upload-failure") expect(result.calls).not.toContain("upload|");
});

test("unconfigured diagnostics still build but do not upload", async () => {
  const result = await runBuild("disabled");
  expect(result.exitCode).toBe(0);
  expect(result.calls).toContain("build|");
  expect(result.calls).not.toContain("upload|");
});
