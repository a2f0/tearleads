import { expect, test } from "bun:test";
import { chmod, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { commitDeploymentFixture } from "./deploymentGit.testUtils";

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
    sourceScript: resolve(
      import.meta.dir,
      "../../../scripts/deploy/deployStaging.sh",
    ),
    commands: [
      ["storage", "terraform/scripts/prepare-storage.sh"],
      ["postgres", "terraform/scripts/prepare-postgres.sh"],
      ["api", "packages/api/scripts/deployApi.sh"],
      ["edge", "terraform/scripts/run-edge-stack.sh"],
      ["api-verify", "packages/api/scripts/verifyApi.sh"],
      ["website", "scripts/deploy/deployStagingWebsite.sh"],
      ["app-web", "packages/app-web/scripts/deployStagingAppWeb.sh"],
    ],
  },
  {
    name: "production",
    tier: "prod",
    sourceScript: resolve(
      import.meta.dir,
      "../../../scripts/deploy/deployProduction.sh",
    ),
    commands: [
      ["storage", "terraform/scripts/prepare-storage.sh"],
      ["postgres", "terraform/scripts/prepare-postgres.sh"],
      ["api", "packages/api/scripts/deployApi.sh"],
      ["edge", "terraform/scripts/run-edge-stack.sh"],
      ["api-verify", "packages/api/scripts/verifyApi.sh"],
      ["website", "scripts/deploy/deployProductionWebsite.sh"],
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
      const matrix = await mkdtemp(resolve(tmpdir(), "tearleads-deploy-tier-"));
      const root = resolve(matrix, "checkouts/tearleads");
      const script = resolve(root, `scripts/deploy/deploy-${fixture.name}.sh`);
      const logPath = resolve(root, "calls.log");

      try {
        await mkdir(resolve(root, "scripts/lib"), { recursive: true });
        await mkdir(dirname(script), { recursive: true });
        await cp(fixture.sourceScript, script);
        await cp(
          resolve(dirname(fixture.sourceScript), "../lib/stepTimings.sh"),
          resolve(root, "scripts/lib/stepTimings.sh"),
        );
        await chmod(script, 0o755);
        commitDeploymentFixture(matrix, "matrix");
        commitDeploymentFixture(root, fixture.name);
        for (const [name, path] of fixture.commands) {
          await writeExecutable(
            resolve(root, path),
            `#!/bin/sh\nprintf '%s|%s\\n' '${name}' "$*" >> "$DEPLOY_TIER_TEST_LOG"\n`,
          );
        }

        const child = Bun.spawn([script, ...(flag ? [flag] : [])], {
          cwd: matrix,
          env: {
            ...process.env,
            PATH: environmentValue("PATH") ?? "",
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
          "app-web|",
          ...(flag ? [] : [`edge|${fixture.tier} apply -auto-approve`]),
          `api-verify|${fixture.tier}`,
          `website|${flag ? "--skip-terraform" : ""}`,
        ]);
        if (!flag) {
          await rm(resolve(root, ".git"), { recursive: true });
          await rm(logPath);
          const rejected = Bun.spawnSync([script], {
            cwd: matrix,
            env: {
              PATH: environmentValue("PATH"),
              DEPLOY_TIER_TEST_LOG: logPath,
            },
          });
          expect(rejected.exitCode).toBe(1);
          expect(rejected.stderr.toString()).toContain(
            "requires its own Git checkout",
          );
          expect(await Bun.file(logPath).exists()).toBe(false);
        }
      } finally {
        await rm(matrix, { recursive: true, force: true });
      }
    });
  }
}
