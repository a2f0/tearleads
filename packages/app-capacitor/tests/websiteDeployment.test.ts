import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

async function runWebsite(script: string, args: string[] = [], failure = "") {
  const root = await mkdtemp(resolve(tmpdir(), "tearleads-website-deploy-"));
  async function executable(path: string, source: string) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, source);
    await chmod(path, 0o755);
  }
  try {
    for (const path of [
      "packages/website/scripts/deployWebsite.sh",
      "packages/website/scripts/deployStagingWebsite.sh",
      "packages/website/scripts/deployProductionWebsite.sh",
      "packages/website/scripts/destroyStagingWebsite.sh",
      "terraform/scripts/run-website-stack.sh",
    ]) {
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await cp(resolve(import.meta.dir, "../../..", path), resolve(root, path));
    }
    await executable(
      resolve(root, "bin/git"),
      '#!/bin/sh\nprintf "%s\\n" "$WEBSITE_TEST_ROOT"\n',
    );
    await executable(
      resolve(root, "terraform/scripts/common.sh"),
      [
        'load_secrets_env() { echo "secrets|$1" >> "$WEBSITE_TEST_LOG"; }',
        'validate_cloudflare_env() { [ "$WEBSITE_TEST_FAILURE" != credentials ] || exit 7; }',
        "validate_domain_env() { :; }",
        'validate_aws_env() { echo aws >> "$WEBSITE_TEST_LOG"; }',
        "get_backend_config() { echo /fixture/backend.hcl; }",
      ].join("\n"),
    );
    await executable(
      resolve(root, "bin/bun"),
      [
        "#!/bin/sh",
        '[ "$CLOUDFLARE_API_TOKEN" = fixture-token ] || exit 11',
        '[ "$CLOUDFLARE_ACCOUNT_ID" = fixture-account ] || exit 12',
        'printf "bun|%s|%s|%s\\n" "$*" "$PUBLIC_ENVIRONMENT" "$PUBLIC_STRIPE_CUSTOMER_PORTAL_URL" >> "$WEBSITE_TEST_LOG"',
        'case "$WEBSITE_TEST_FAILURE:$*" in "build:run build"|"upload:run deploy:assets"*) exit 8 ;; esac',
      ].join("\n"),
    );
    await executable(
      resolve(root, "bin/terraform"),
      [
        "#!/bin/sh",
        'printf "terraform|%s\\n" "$*" >> "$WEBSITE_TEST_LOG"',
        'case "$*" in *" init "*) echo init-noise ;; *" output -raw url") echo https://fixture.test ;; esac',
        'case "$WEBSITE_TEST_FAILURE:$*" in terraform:*apply*|terraform:*destroy*) exit 9 ;; esac',
      ].join("\n"),
    );
    const log = resolve(root, "calls.log");
    const child = Bun.spawn(["bash", resolve(root, script), ...args], {
      env: {
        PATH: `${root}/bin:/usr/bin:/bin`,
        WEBSITE_TEST_ROOT: root,
        WEBSITE_TEST_LOG: log,
        WEBSITE_TEST_FAILURE: failure,
        TF_VAR_cloudflare_api_token: "fixture-token",
        TF_VAR_cloudflare_account_id: "fixture-account",
        PUBLIC_ENVIRONMENT: "",
        PUBLIC_STRIPE_CUSTOMER_PORTAL_URL:
          "https://billing.stripe.com/p/login/live_fixture",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const calls = (await Bun.file(log).exists())
      ? (await Bun.file(log).text()).trim().replaceAll(root, "ROOT").split("\n")
      : [];
    expect(stdout + stderr).not.toContain("fixture-token");
    return { exitCode, stdout, stderr, calls };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const [label, tier, environment, portal] of [
  ["Staging", "staging", "staging", "test_00w7sKaemgcfdhb5lR0x200"],
  ["Production", "prod", "production", "live_fixture"],
]) {
  const script = `packages/website/scripts/deploy${label}Website.sh`;
  test(`${tier} builds, publishes assets, then attaches its independent domain`, async () => {
    const result = await runWebsite(script);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.calls).toEqual([
      `secrets|${tier}`,
      "aws",
      `bun|run build|${environment}|https://billing.stripe.com/p/login/${portal}`,
      `bun|run deploy:assets --env ${tier}|${environment}|https://billing.stripe.com/p/login/${portal}`,
      `secrets|${tier}`,
      "aws",
      `terraform|-chdir=ROOT/terraform/stacks/${tier}/website init -input=false -reconfigure -backend-config=/fixture/backend.hcl`,
      `terraform|-chdir=ROOT/terraform/stacks/${tier}/website apply -input=false -auto-approve`,
    ]);
  });
  for (const failure of ["credentials", "build", "upload"]) {
    test(`${tier} ${failure} failure leaves the domain untouched`, async () => {
      const result = await runWebsite(script, [], failure);
      expect(result.exitCode).not.toBe(0);
      expect(result.calls.some((call) => call.startsWith("terraform|"))).toBe(
        false,
      );
      if (failure !== "upload") {
        expect(
          result.calls.some((call) => call.includes("deploy:assets")),
        ).toBe(false);
      }
    });
  }
  test(`${tier} can publish without Terraform or backend credentials`, async () => {
    const result = await runWebsite(script, ["--skip-terraform"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.calls).not.toContain("aws");
    expect(result.calls.some((call) => call.startsWith("terraform|"))).toBe(
      false,
    );
  });
  test(`${tier} dry run validates assets and plans the domain without applying`, async () => {
    const result = await runWebsite(script, ["--dry-run"]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(
      result.calls.some((call) =>
        call.includes(`deploy:assets --env ${tier} --dry-run`),
      ),
    ).toBe(true);
    expect(result.calls.at(-1)).toBe(
      `terraform|-chdir=ROOT/terraform/stacks/${tier}/website plan -input=false`,
    );
  });
}

test("staging website teardown removes its domain before deleting assets", async () => {
  const result = await runWebsite(
    "packages/website/scripts/destroyStagingWebsite.sh",
    ["--auto-approve"],
  );
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls.slice(-2)).toEqual([
    "terraform|-chdir=ROOT/terraform/stacks/staging/website destroy --auto-approve",
    "bun|run destroy:assets --env staging --force||https://billing.stripe.com/p/login/live_fixture",
  ]);
});

test("failed domain teardown retains staging assets", async () => {
  const result = await runWebsite(
    "packages/website/scripts/destroyStagingWebsite.sh",
    [],
    "terraform",
  );
  expect(result.exitCode).toBe(9);
  expect(result.calls.some((call) => call.startsWith("bun|"))).toBe(false);
});

for (const [script, args] of [
  ["packages/website/scripts/deployWebsite.sh", []],
  ["packages/website/scripts/deployWebsite.sh", ["unknown"]],
  ["packages/website/scripts/deployWebsite.sh", ["prod", "--unknown"]],
  ["packages/website/scripts/destroyStagingWebsite.sh", ["-target=wrong"]],
  ["terraform/scripts/run-website-stack.sh", []],
  ["terraform/scripts/run-website-stack.sh", ["unknown", "apply"]],
  ["terraform/scripts/run-website-stack.sh", ["prod", "unknown"]],
  [
    "terraform/scripts/run-website-stack.sh",
    ["prod", "destroy", "-auto-approve"],
  ],
] as const) {
  test(`${script} rejects ${args.join(" ")} before loading credentials`, async () => {
    const result = await runWebsite(script, [...args]);
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
  });
}

test("website output contains only the requested Terraform value", async () => {
  const result = await runWebsite("terraform/scripts/run-website-stack.sh", [
    "prod",
    "output",
    "-raw",
    "url",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toBe("https://fixture.test\n");
  expect(result.stderr).toContain("init-noise");
});

test("website initialization forwards provider upgrade arguments", async () => {
  const result = await runWebsite("terraform/scripts/run-website-stack.sh", [
    "staging",
    "init",
    "-upgrade",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.calls.at(-1)).toBe(
    "terraform|-chdir=ROOT/terraform/stacks/staging/website init -input=false -reconfigure -backend-config=/fixture/backend.hcl -upgrade",
  );
  expect(
    result.calls.filter((call) => call.startsWith("terraform|")),
  ).toHaveLength(1);
});
