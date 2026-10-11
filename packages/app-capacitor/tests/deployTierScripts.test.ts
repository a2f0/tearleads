import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

interface TierFixture {
  readonly name: "staging" | "production";
  /** Tier argument the orchestrator passes to every step. */
  readonly tier: "staging" | "prod";
  readonly sourceScript: string;
  readonly commands: ReadonlyArray<readonly [name: string, path: string]>;
}

const fixtures: readonly TierFixture[] = [
  {
    name: "staging",
    tier: "staging",
    sourceScript: resolve(import.meta.dir, "../../../scripts/deployStaging.sh"),
    commands: [
      ["storage", "terraform/scripts/prepare-storage.sh"],
      ["postgres", "terraform/scripts/prepare-postgres.sh"],
      ["api", "packages/api/scripts/deployApi.sh"],
      ["edge", "terraform/scripts/run-edge-stack.sh"],
      ["api-verify", "packages/api/scripts/verifyApi.sh"],
      ["website", "scripts/deployStagingWebsite.sh"],
      ["app-web", "packages/app-web/scripts/deployStagingAppWeb.sh"],
    ],
  },
  {
    name: "production",
    tier: "prod",
    sourceScript: resolve(
      import.meta.dir,
      "../../../scripts/deployProduction.sh",
    ),
    commands: [
      ["storage", "terraform/scripts/prepare-storage.sh"],
      ["postgres", "terraform/scripts/prepare-postgres.sh"],
      ["api", "packages/api/scripts/deployApi.sh"],
      ["edge", "terraform/scripts/run-edge-stack.sh"],
      ["api-verify", "packages/api/scripts/verifyApi.sh"],
      ["website", "scripts/deployProductionWebsite.sh"],
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
  for (const flag of ["", "--skip-terraform", "--skip-infra"]) {
    test(`${fixture.name} deploy preserves ordering with ${flag || "all infrastructure"}`, async () => {
      const root = await mkdtemp(resolve(tmpdir(), "tearleads-deploy-tier-"));
      const script = resolve(root, `scripts/deploy-${fixture.name}.sh`);
      const logPath = resolve(root, "calls.log");
      const binDirectory = resolve(root, "bin");

      try {
        await mkdir(resolve(root, "scripts/lib"), { recursive: true });
        await cp(fixture.sourceScript, script);
        await cp(
          resolve(dirname(fixture.sourceScript), "lib/stepTimings.sh"),
          resolve(root, "scripts/lib/stepTimings.sh"),
        );
        await chmod(script, 0o755);
        await writeExecutable(
          resolve(binDirectory, "git"),
          "#!/bin/sh\nprintf '%s\\n' \"$DEPLOY_TIER_TEST_ROOT\"\n",
        );
        for (const [name, path] of fixture.commands) {
          await writeExecutable(
            resolve(root, path),
            `#!/bin/sh\nprintf '%s|%s\\n' '${name}' "$*" >> "$DEPLOY_TIER_TEST_LOG"\n`,
          );
        }

        const child = Bun.spawn([script, ...(flag ? [flag] : [])], {
          cwd: tmpdir(),
          env: {
            ...process.env,
            PATH: `${binDirectory}:${environmentValue("PATH") ?? ""}`,
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
        if (flag) expect(stdout).toContain("skipped (--skip-terraform)");
        expect((await readFile(logPath, "utf8")).trim().split("\n")).toEqual([
          ...(flag
            ? []
            : [`storage|${fixture.tier}`, `postgres|${fixture.tier}`]),
          `api|${fixture.tier}`,
          ...(flag ? [] : [`edge|${fixture.tier} apply -auto-approve`]),
          `api-verify|${fixture.tier}`,
          `website|${flag ? "--skip-terraform" : ""}`,
          "app-web|",
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}
