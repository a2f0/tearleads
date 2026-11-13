import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function fixture(tier: "prod" | "staging" = "prod") {
  const root = mkdtempSync(join(tmpdir(), "soft-reset-"));
  const home = join(root, "home");
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const env = {
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
    TMPDIR: root,
    SOFT_RESET_FIXTURE: root,
    LANG: "en_US.UTF-8",
  };
  for (const path of [home, repo, bin]) mkdirSync(path);
  writeFileSync(join(root, "tier"), tier);
  mkdirSync(join(repo, "scripts/deploy"), { recursive: true });
  function write(path: string, text: string) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text, { mode: 0o755 });
  }
  for (const name of readdirSync(import.meta.dir)) {
    if (name.startsWith("softReset") && !name.includes(".test")) {
      cpSync(join(import.meta.dir, name), join(repo, "scripts/deploy", name), {
        recursive: true,
      });
    }
  }
  cpSync(
    join(import.meta.dir, "softResetProvider.testUtils.ts"),
    join(root, "provider.ts"),
  );
  const stub = `#!/bin/sh\nexec '${process.execPath}' '${root}/provider.ts' "$0" "$@"\n`;
  for (const tool of [
    "bun",
    "bunx",
    "terraform",
    "aws",
    "psql",
    "curl",
    "jq",
    "python3",
  ]) {
    writeFileSync(join(bin, tool), stub, { mode: 0o755 });
  }
  for (const stack of ["postgres", "storage", "edge", "website"]) {
    write(`terraform/scripts/run-${stack}-stack.sh`, stub);
    for (const tier of ["prod", "staging"])
      mkdirSync(join(repo, "terraform/stacks", tier, stack), {
        recursive: true,
      });
  }
  for (const path of [
    "terraform/scripts/drop-postgres-owned.sh",
    "terraform/scripts/empty-r2-bucket.sh",
    "packages/api/scripts/deployApiMaintenance.sh",
    "packages/api/scripts/deployApi.sh",
    "packages/api/scripts/verifyApi.sh",
    "packages/app-web/scripts/deployAppWeb.sh",
    "packages/website/scripts/deployWebsite.sh",
  ])
    write(path, stub);
  write(
    "terraform/scripts/common.sh",
    `
load_secrets_env() {
  export TF_VAR_cloudflare_account_id=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  export TF_VAR_planetscale_organization=tearleads TF_VAR_domain=example.test
  export PLANETSCALE_SERVICE_TOKEN_ID=fixture PLANETSCALE_SERVICE_TOKEN=fixture
  export DOCUMENT_SYNC_CURSOR_HMAC_KEY=12345678901234567890123456789012
  export BLOB_GC_HEALTHCHECK_URL=https://example.test/health
}
_source_optional_env_file() { :; }
validate_tf_state_env() { :; }
validate_cloudflare_env() { :; }
validate_domain_env() { :; }
validate_stripe_env() { :; }
export_wrangler_env() { :; }
tier_api_hostname() { [ "$1" = prod ] && printf api.example.test || printf api-staging.example.test; }
tier_app_hostname() { [ "$1" = prod ] && printf app.example.test || printf app-staging.example.test; }
tier_demo_hostname() { [ "$1" = prod ] && printf demo.example.test || printf demo-staging.example.test; }
`,
  );
  write(
    "packages/api/scripts/sentryBuild.sh",
    "configure_api_sentry() { :; }\n",
  );
  write(
    "packages/app-web/scripts/sentryEnv.sh",
    "configure_sentry_env() { :; }\n",
  );
  write("packages/api/wrangler.jsonc", "{}");
  write("packages/api/scripts/workerDefines.ts", "");
  write("packages/app-web/package.json", "{}");
  write("packages/website/package.json", "{}");
  write(
    "packages/api-shared/drizzle/0000_greenfield_baseline.sql",
    ["users", "blobs", "blob_stages", "containers", "container_sync_tombstones"]
      .map((name) => `CREATE TABLE "${name}" (id text);\n`)
      .join(""),
  );
  write(".gitignore", "*_override.tf\nnode_modules/\n");
  write("package.json", "{}");
  for (const args of [
    ["init", "--quiet"],
    ["add", "."],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
  ]) {
    const result = Bun.spawnSync(["git", ...args], { cwd: repo, env });
    if (result.exitCode) throw new Error(result.stderr.toString());
  }
  const command = [
    process.execPath,
    join(repo, "scripts/deploy/softReset.ts"),
    tier,
    "--apply",
    "--confirm",
    `RESET ${tier} APPLICATION DATA`,
  ];
  return {
    root,
    repo,
    home,
    env,
    command,
    write,
    run: () => Bun.spawnSync(command, { cwd: repo, env }),
    calls: () =>
      readFileSync(join(root, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
    records: () => {
      const dir = join(home, ".local/state/tearleads-soft-reset");
      const name = readdirSync(dir).find((name) => name.startsWith("run-"));
      if (!name) throw new Error("missing run record");
      return {
        dir: join(dir, name),
        record: JSON.parse(
          readFileSync(join(dir, name, "timings.json"), "utf8"),
        ),
      };
    },
  };
}
