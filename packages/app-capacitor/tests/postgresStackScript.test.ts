import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

async function runWrapper(
  args: string[],
  options: {
    tokenId?: string;
    token?: string;
    cloudflareToken?: string;
    initStatus?: string;
    stateKeyId?: string;
    stateSecret?: string;
  } = {},
) {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-postgres-stack-"));
  const bin = resolve(root, "bin");
  const scripts = resolve(root, "terraform/scripts");
  const log = resolve(root, "calls.log");
  // Only the invoked tier's folder holds secrets, so reading another tier's
  // files leaves the credentials unset.
  const secrets = resolve(
    root,
    ".secrets",
    args[0] === "staging" ? "staging" : "prod",
  );
  try {
    await mkdir(bin);
    await mkdir(scripts, { recursive: true });
    await mkdir(secrets, { recursive: true });
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
      resolve(secrets, "shared.env"),
      [
        // The account's AWS keys must never reach the R2 state backend.
        "AWS_ACCESS_KEY_ID=ambient-aws-id",
        "AWS_SECRET_ACCESS_KEY=ambient-aws-secret",
        "TF_VAR_cloudflare_account_id=fixture-account",
        `TF_VAR_cloudflare_api_token=${options.cloudflareToken ?? "fixture-cloudflare-token"}`,
      ].join("\n"),
    );
    await Bun.write(
      resolve(secrets, "app.env"),
      [
        `TF_STATE_ACCESS_KEY_ID=${options.stateKeyId ?? "fixture-state-id"}`,
        `TF_STATE_SECRET_ACCESS_KEY=${options.stateSecret ?? "fixture-state-secret"}`,
      ].join("\n"),
    );
    await Bun.write(
      resolve(secrets, "planetscale.env"),
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
        // Terraform sees only the R2 state key, never an ambient AWS login.
        '[ "$AWS_ACCESS_KEY_ID" = fixture-state-id ] && [ "$AWS_SECRET_ACCESS_KEY" = fixture-state-secret ] || exit 93',
        "! env | grep -Eq '^AWS_(PROFILE|DEFAULT_PROFILE|SESSION_TOKEN|SECURITY_TOKEN)=' || exit 94",
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
          AWS_PROFILE: "inherited-profile",
          AWS_DEFAULT_PROFILE: "inherited-profile",
          AWS_SESSION_TOKEN: "inherited-session",
          AWS_SECURITY_TOKEN: "inherited-session",
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

const stackArg = (tier: string) =>
  `-chdir=<repo>/terraform/stacks/${tier}/postgres`;
const initCall = (tier: string) =>
  `${stackArg(tier)}|init|-input=false|-reconfigure`;

for (const args of [[], ["prod"], ["prod", "destroy"], ["unknown", "apply"]]) {
  test(`rejects unsupported invocation ${args.join(" ") || "(missing)"}`, async () => {
    const result = await runWrapper(args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.calls).toEqual([]);
  });
}

for (const action of ["plan", "apply"]) {
  for (const missing of ["tokenId", "token"] as const) {
    test(`${action} rejects missing ${missing} before Terraform`, async () => {
      const result = await runWrapper(["prod", action], { [missing]: "" });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(".secrets/prod/planetscale.env");
      expect(result.stderr).not.toContain("fixture-token");
      expect(result.calls).toEqual([]);
    });
  }

  for (const tier of ["prod", "staging"]) {
    test(`${tier} ${action} disables prompts and preserves argument boundaries`, async () => {
      const args =
        action === "plan"
          ? ["-var-file=inputs with spaces.tfvars", "-out=saved plan.tfplan"]
          : ["saved plan.tfplan"];
      const result = await runWrapper([tier, action, ...args]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.calls).toEqual([
        initCall(tier),
        `${stackArg(tier)}|${action}|-input=false|${args.join("|")}`,
      ]);
    });
  }
}

test("staging destroy disables prompts and requires provider credentials", async () => {
  const rejected = await runWrapper(["staging", "destroy"], { token: "" });
  expect(rejected.exitCode).toBe(1);
  expect(rejected.calls).toEqual([]);
  const result = await runWrapper(["staging", "destroy", "-auto-approve"]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toEqual([
    initCall("staging"),
    `${stackArg("staging")}|destroy|-input=false|-auto-approve`,
  ]);
});

test("output keeps stdout parseable without provider credentials", async () => {
  const result = await runWrapper(["prod", "output", "-json", "database"], {
    token: "",
    tokenId: "",
    cloudflareToken: "",
  });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ name: "tearleads-prod" });
  expect(result.stderr).toContain("initializing backend");
  expect(result.calls).toEqual([
    initCall("prod"),
    `${stackArg("prod")}|output|-json|database`,
  ]);
});

test("init forwards arguments without requiring provider credentials", async () => {
  const result = await runWrapper(["prod", "init", "-upgrade"], {
    token: "",
    tokenId: "",
    cloudflareToken: "",
  });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls).toEqual([`${initCall("prod")}|-upgrade`]);
});

test("planning Hyperdrive requires Cloudflare credentials before Terraform", async () => {
  const result = await runWrapper(["prod", "plan"], { cloudflareToken: "" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("TF_VAR_cloudflare_api_token");
  expect(result.stderr).not.toContain("fixture-cloudflare-token");
  expect(result.calls).toEqual([]);
});

test("failed initialization prevents apply", async () => {
  const result = await runWrapper(["prod", "apply", "saved.tfplan"], {
    initStatus: "7",
  });
  expect(result.exitCode).toBe(7);
  expect(result.calls).toEqual([initCall("prod")]);
});

for (const missing of ["stateKeyId", "stateSecret"] as const) {
  test(`a missing R2 state ${missing} stops before Terraform`, async () => {
    const result = await runWrapper(["prod", "output", "-json", "database"], {
      [missing]: "",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      missing === "stateKeyId"
        ? "TF_STATE_ACCESS_KEY_ID"
        : "TF_STATE_SECRET_ACCESS_KEY",
    );
    expect(result.stderr).not.toContain("fixture-state-secret");
    expect(result.calls).toEqual([]);
  });
}
