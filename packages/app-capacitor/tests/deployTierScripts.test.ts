import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

interface TierFixture {
  readonly name: "staging" | "production";
  readonly sourceScript: string;
  readonly commands: ReadonlyArray<readonly [name: string, path: string]>;
}

const fixtures: readonly TierFixture[] = [
  {
    name: "staging",
    sourceScript: resolve(import.meta.dir, "../../../scripts/deployStaging.sh"),
    commands: [
      ["terraform", "terraform/stacks/staging/server/scripts/apply.sh"],
      ["ansible", "ansible/scripts/run-server-staging.sh"],
      ["api", "packages/api/scripts/deployStagingApi.sh"],
      ["website", "packages/website/scripts/deployStagingWebsite.sh"],
      ["app-web", "packages/app-web/scripts/deployStagingAppWeb.sh"],
    ],
  },
  {
    name: "production",
    sourceScript: resolve(
      import.meta.dir,
      "../../../scripts/deployProduction.sh",
    ),
    commands: [
      ["terraform", "terraform/stacks/prod/server/scripts/apply.sh"],
      ["ansible", "ansible/scripts/run-server-prod.sh"],
      ["api", "packages/api/scripts/deployProductionApi.sh"],
      ["website", "packages/website/scripts/deployProductionWebsite.sh"],
      ["app-web", "packages/app-web/scripts/deployProductionAppWeb.sh"],
    ],
  },
];

function environmentValue(name: string): string | undefined {
  return process.env[name];
}

async function writeExecutable(path: string, source: string) {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, source);
  await chmod(path, 0o755);
}

for (const fixture of fixtures) {
  test(`${fixture.name} skips only Terraform when requested`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "tearleads-deploy-tier-"));
    const script = resolve(root, `scripts/deploy-${fixture.name}.sh`);
    const logPath = resolve(root, "calls.log");
    const binDirectory = resolve(root, "bin");

    try {
      await mkdir(dirname(script), { recursive: true });
      await cp(fixture.sourceScript, script);
      await chmod(script, 0o755);
      await writeExecutable(
        resolve(binDirectory, "git"),
        "#!/bin/sh\nprintf '%s\\n' \"$DEPLOY_TIER_TEST_ROOT\"\n",
      );
      await writeExecutable(
        resolve(root, "terraform/scripts/common.sh"),
        [
          "load_secrets_env() {",
          '  case "$1" in',
          '    staging) SSH_TARGET="$STAGING_SSH_TARGET" ;;',
          '    prod) SSH_TARGET="$PRODUCTION_SSH_TARGET" ;;',
          "  esac",
          "  export SSH_TARGET",
          "}",
          "validate_aws_env() { :; }",
        ].join("\n"),
      );
      for (const [name, path] of fixture.commands) {
        await writeExecutable(
          resolve(root, path),
          `#!/bin/sh\nprintf '%s|%s\\n' '${name}' "\${SSH_TARGET:-}" >> "$DEPLOY_TIER_TEST_LOG"\n`,
        );
      }

      const child = Bun.spawn([script, "--skip-terraform"], {
        cwd: tmpdir(),
        env: {
          ...process.env,
          PATH: `${binDirectory}:${environmentValue("PATH") ?? ""}`,
          SSH_TARGET: "stale-user@wrong-tier-host",
          STAGING_SSH_TARGET: "deploy-user@tier-host",
          PRODUCTION_SSH_TARGET: "deploy-user@tier-host",
          DEPLOY_TIER_TEST_ROOT: root,
          DEPLOY_TIER_TEST_LOG: logPath,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("skipped (--skip-terraform)");
      expect((await readFile(logPath, "utf8")).trim().split("\n")).toEqual([
        "ansible|deploy-user@tier-host",
        "api|deploy-user@tier-host",
        "website|deploy-user@tier-host",
        "app-web|deploy-user@tier-host",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
