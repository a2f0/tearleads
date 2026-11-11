import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { ciScopes } from "../ciPolicy";

interface Step {
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: { SUITE_FILTER?: string };
}
interface Job {
  uses?: string;
  if?: string;
  with?: { force?: boolean | string };
  steps?: Step[];
  strategy?: {
    matrix?: { include?: { filter?: string; args?: string }[] };
  };
}
interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, Job>;
}
const root = `${import.meta.dir}/../../..`;

async function workflow(file: string): Promise<Workflow> {
  return Bun.YAML.parse(
    await Bun.file(`${root}/.github/workflows/${file}`).text(),
  ) as Workflow;
}

function assertNodeBefore(steps: Step[], consumer: number) {
  expect(consumer).toBeGreaterThanOrEqual(0);
  const setup = steps.findIndex(({ uses }) =>
    uses?.startsWith("actions/setup-node@"),
  );
  expect(setup).toBeGreaterThanOrEqual(0);
  expect(setup).toBeLessThan(consumer);
  expect(steps[setup]?.if).toBeUndefined();
  expect(steps[setup]?.with).toMatchObject({
    "node-version-file": ".nvmrc",
    "package-manager-cache": false,
  });
  // A direct version overrides the file in setup-node.
  expect(steps[setup]?.with).not.toHaveProperty("node-version");
}

test("every SDK suite caller installs the pinned Node before keying and running tests", async () => {
  const callers: string[] = [];
  for (const file of await readdir(`${root}/.github/workflows`)) {
    if (!file.endsWith(".yml")) continue;
    for (const [name, job] of Object.entries((await workflow(file)).jobs)) {
      const steps = job.steps ?? [];
      const matrix = job.strategy?.matrix?.include ?? [];
      const sdkLanes = matrix.filter(
        ({ filter }) => filter === "@tearleads/client-sdk",
      );
      const testIndex = steps.findIndex(({ run = "" }) => {
        if (/runVerifiedTurbo\.ts test(?:\s|$)/.test(run)) {
          if (run.includes("$SUITE_FILTER")) return sdkLanes.length > 0;
          if (run.includes("--filter='!@tearleads/client-sdk'")) return false;
          return (
            !run.includes("--filter") || run.includes("@tearleads/client-sdk")
          );
        }
        return (
          /check:package\s+@tearleads\/client-sdk\b/.test(run) ||
          /--cwd\s+packages\/client-sdk\s+(?:run\s+)?test\b/.test(run) ||
          /^bun run (?:test|check|check:affected)\s*$/.test(run)
        );
      });
      if (testIndex < 0) continue;
      callers.push(`${file}:${name}`);
      expect(job.if).toBeUndefined();
      expect(steps[testIndex]?.if).toBeUndefined();
      if (sdkLanes.length > 0) {
        expect(sdkLanes.map(({ args }) => args).toSorted()).toEqual([
          "--shard=1/2",
          "--shard=2/2",
        ]);
        expect(steps[testIndex]?.env?.SUITE_FILTER).toBe(
          "$" + "{{ matrix.filter }}",
        );
      }
      const keyIndex = steps.findIndex(({ run }) =>
        run?.includes("CI_TOOLCHAIN="),
      );
      assertNodeBefore(steps, keyIndex);
      expect(keyIndex).toBeLessThan(testIndex);
      expect(steps[keyIndex]?.if).toBeUndefined();
      expect(steps[keyIndex]?.run).toBe(
        `echo "CI_TOOLCHAIN=bun-$(bun --version)-node-$(node --version)-\${RUNNER_OS}-\${RUNNER_ARCH}" >> "$GITHUB_ENV"`,
      );
      const cacheIndex = steps.findIndex(({ uses }) =>
        uses?.startsWith("rharkor/caching-for-turbo@"),
      );
      expect(keyIndex).toBeLessThan(cacheIndex);
      expect(cacheIndex).toBeLessThan(testIndex);
    }
  }
  expect(callers).toEqual(["ci.yml:test"]);
  const nightly = await workflow("uncached-tests.yml");
  const { checks } = nightly.jobs;
  expect(nightly.on).toHaveProperty("schedule");
  expect(checks?.uses).toBe("./.github/workflows/ci.yml");
  expect(checks?.with?.force).toBe(true);
  expect((await workflow("ci.yml")).on).toHaveProperty("workflow_call");
});

test("Node setup consumers share the exact existing build-runtime pin", async () => {
  const pin = Bun.file(`${root}/.nvmrc`);
  expect(await pin.exists()).toBe(true);
  expect(await pin.text()).toBe("24.22.2\n");
  const consumers: string[] = [];
  for (const file of await readdir(`${root}/.github/workflows`)) {
    if (!file.endsWith(".yml")) continue;
    for (const [name, job] of Object.entries((await workflow(file)).jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses?.startsWith("actions/setup-node@")) continue;
        consumers.push(`${file}:${name}`);
        expect(step.with).toMatchObject({
          "node-version-file": ".nvmrc",
          "package-manager-cache": false,
        });
        expect(step.with).not.toHaveProperty("node-version");
      }
    }
  }
  expect(consumers.toSorted()).toEqual([
    "ci.yml:build",
    "ci.yml:test",
    "client-sdk-publish.yml:publish",
    "windowing-publish.yml:publish",
  ]);
});

test("Node pins and suite wiring invalidate Turbo and CI inputs", async () => {
  const turbo = await Bun.file(`${root}/turbo.json`).json();
  expect(turbo.globalDependencies).toContain(".nvmrc");
  expect(turbo.globalEnv).toContain("CI_TOOLCHAIN");
  const sdk = await Bun.file(`${root}/packages/client-sdk/turbo.json`).json();
  expect(sdk.tasks.test.inputs).toEqual([
    "$TURBO_EXTENDS$",
    "$TURBO_ROOT$/.github/workflows/ci.yml",
    "$TURBO_ROOT$/.github/workflows/uncached-tests.yml",
  ]);
  expect(ciScopes([".nvmrc"])).toEqual({
    native: true,
    proofs: true,
    terraform: true,
  });
  for (const file of ["client-sdk-publish.yml", "windowing-publish.yml"]) {
    const { push } = (await workflow(file)).on as {
      push: { paths: string[] };
    };
    expect(push.paths).toContain(".nvmrc");
  }
});
