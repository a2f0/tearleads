import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

async function runWrapper(
  args: string[],
  options: { tokenId?: string; token?: string; initStatus?: string } = {},
) {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-postgres-stack-"));
  const bin = resolve(root, "bin");
  const scripts = resolve(root, "terraform/scripts");
  const log = resolve(root, "calls.log");
  try {
    await mkdir(bin);
    await mkdir(scripts, { recursive: true });
    await mkdir(resolve(root, ".secrets"));
    for (const file of [
      "run-postgres-stack.sh",
      "common.sh",
      "secretsEnv.sh",
      "stripeEnv.sh",
      "cloudflareCache.sh",
    ]) {
      await cp(
        resolve(import.meta.dir, "../../../terraform/scripts", file),
        resolve(scripts, file),
      );
    }
    await Bun.write(
      resolve(root, ".secrets/root.env"),
      "AWS_ACCESS_KEY_ID=fixture-id\nAWS_SECRET_ACCESS_KEY=fixture-secret\n",
    );
    await Bun.write(
      resolve(root, ".secrets/planetscale.env"),
      [
        `PLANETSCALE_SERVICE_TOKEN_ID=${options.tokenId ?? "fixture-id"}`,
        `PLANETSCALE_SERVICE_TOKEN=${options.token ?? "fixture-token"}`,
      ].join("\n"),
    );
    await Bun.write(log, "");
    await Bun.write(
      resolve(bin, "git"),
      '#!/bin/sh\nprintf "%s\\n" "$POSTGRES_TEST_ROOT"\n',
    );
    await Bun.write(
      resolve(bin, "terraform"),
      [
        "#!/bin/sh",
        '{ printf "%s" "$1"; shift; printf "|%s" "$@"; printf "\\n"; } >> "$POSTGRES_TEST_LOG"',
        'if [ "$1" = init ]; then',
        '  echo "initializing backend"',
        '  exit "$POSTGRES_TEST_INIT_STATUS"',
        "fi",
        'if [ "$1" = output ]; then',
        "  printf '%s\\n' '{\"name\":\"tearleads-prod\"}'",
        "fi",
      ].join("\n"),
    );
    await chmod(resolve(bin, "git"), 0o755);
    await chmod(resolve(bin, "terraform"), 0o755);

    const child = Bun.spawn(
      ["bash", resolve(scripts, "run-postgres-stack.sh"), ...args],
      {
        cwd: tmpdir(),
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          POSTGRES_TEST_ROOT: root,
          POSTGRES_TEST_LOG: log,
          POSTGRES_TEST_INIT_STATUS: options.initStatus ?? "0",
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
      stdout,
      stderr,
      calls: (await readFile(log, "utf8"))
        .replaceAll(root, "<repo>")
        .trim()
        .split("\n")
        .filter(Boolean),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const stackArg = "-chdir=<repo>/terraform/stacks/prod/postgres";
const initCall = `${stackArg}|init|-input=false|-reconfigure|-backend-config=<repo>/terraform/configs/backend.hcl`;

for (const args of [[], ["destroy"]]) {
  test(`rejects unsupported action ${args[0] ?? "(missing)"}`, async () => {
    const result = await runWrapper(args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.calls).toEqual([]);
  });
}

for (const action of ["plan", "apply"]) {
  for (const missing of ["tokenId", "token"] as const) {
    test(`${action} rejects missing ${missing} before Terraform`, async () => {
      const result = await runWrapper([action], { [missing]: "" });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(".secrets/planetscale.env");
      expect(result.stderr).not.toContain("fixture-token");
      expect(result.calls).toEqual([]);
    });
  }

  test(`${action} disables prompts and preserves argument boundaries`, async () => {
    const args =
      action === "plan"
        ? ["-var-file=inputs with spaces.tfvars", "-out=saved plan.tfplan"]
        : ["saved plan.tfplan"];
    const result = await runWrapper([action, ...args]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.calls).toEqual([
      initCall,
      `${stackArg}|${action}|-input=false|${args.join("|")}`,
    ]);
  });
}

test("output keeps stdout parseable without provider credentials", async () => {
  const result = await runWrapper(["output", "-json", "database"], {
    token: "",
    tokenId: "",
  });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ name: "tearleads-prod" });
  expect(result.stderr).toContain("initializing backend");
  expect(result.calls).toEqual([initCall, `${stackArg}|output|-json|database`]);
});

test("init forwards arguments without requiring provider credentials", async () => {
  const result = await runWrapper(["init", "-upgrade"], {
    token: "",
    tokenId: "",
  });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toEqual([`${initCall}|-upgrade`]);
});

test("failed initialization prevents apply", async () => {
  const result = await runWrapper(["apply", "saved.tfplan"], {
    initStatus: "7",
  });
  expect(result.exitCode).toBe(7);
  expect(result.calls).toEqual([initCall]);
});
