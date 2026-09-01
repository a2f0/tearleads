import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

interface ApiDeployFixture {
  readonly name: "staging" | "production";
  readonly tier: "staging" | "prod";
  readonly targetVariable: "STAGING_SSH_TARGET" | "PRODUCTION_SSH_TARGET";
}

const fixtures: readonly ApiDeployFixture[] = [
  {
    name: "staging",
    tier: "staging",
    targetVariable: "STAGING_SSH_TARGET",
  },
  {
    name: "production",
    tier: "prod",
    targetVariable: "PRODUCTION_SSH_TARGET",
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
  test(`${fixture.name} API deploy propagates its resolved target to API CLI`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "tearleads-api-deploy-"));
    const binDirectory = resolve(root, "bin");
    const logPath = resolve(root, "loads.log");
    const suffix = fixture.name === "staging" ? "Staging" : "Production";
    const apiRelativePath = `packages/api/scripts/deploy${suffix}Api.sh`;
    const cliRelativePath = `packages/api-cli/scripts/deploy${suffix}ApiCli.sh`;

    try {
      await mkdir(resolve(root, "packages/api/scripts"), { recursive: true });
      await mkdir(resolve(root, "packages/api-cli/scripts"), {
        recursive: true,
      });
      await cp(
        resolve(import.meta.dir, `../../../${apiRelativePath}`),
        resolve(root, apiRelativePath),
      );
      await cp(
        resolve(import.meta.dir, `../../../${cliRelativePath}`),
        resolve(root, cliRelativePath),
      );
      await writeExecutable(
        resolve(root, "terraform/scripts/common.sh"),
        [
          "load_secrets_env() {",
          "  local tier_target",
          '  case "$1" in',
          `    staging) tier_target="\${STAGING_SSH_TARGET:-}" ;;`,
          `    prod) tier_target="\${PRODUCTION_SSH_TARGET:-}" ;;`,
          "  esac",
          `  if [[ -n "\${SSH_TARGET:-}" && "$SSH_TARGET" != "$tier_target" ]]; then`,
          "    return 1",
          "  fi",
          `  SSH_TARGET="\${SSH_TARGET:-deploy-user@tier-host}"`,
          "  export SSH_TARGET",
          `  printf '%s|%s|%s\n' "$1" "$SSH_TARGET" "\${${fixture.targetVariable}:-}" >> "$API_DEPLOY_TEST_LOG"`,
          "}",
          "validate_aws_env() { :; }",
        ].join("\n"),
      );
      await writeExecutable(
        resolve(binDirectory, "git"),
        [
          "#!/bin/sh",
          'case "$*" in',
          '  "rev-parse --show-toplevel") printf \'%s\\n\' "$API_DEPLOY_TEST_ROOT" ;;',
          "  \"rev-parse --short=12 HEAD\") printf 'deadbeef0000\\n' ;;",
          "  *) exit 1 ;;",
          "esac",
        ].join("\n"),
      );
      for (const command of ["bun", "rsync", "ssh"]) {
        await writeExecutable(
          resolve(binDirectory, command),
          "#!/bin/sh\nexit 0\n",
        );
      }

      const child = Bun.spawn([resolve(root, apiRelativePath)], {
        env: {
          ...process.env,
          PATH: `${binDirectory}:${environmentValue("PATH") ?? ""}`,
          SSH_TARGET: "",
          STAGING_SSH_TARGET: "",
          PRODUCTION_SSH_TARGET: "",
          API_DEPLOY_TEST_ROOT: root,
          API_DEPLOY_TEST_LOG: logPath,
        },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      expect((await readFile(logPath, "utf8")).trim().split("\n")).toEqual([
        `${fixture.tier}|deploy-user@tier-host|`,
        `${fixture.tier}|deploy-user@tier-host|deploy-user@tier-host`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
