import { expect, test } from "bun:test";

interface Workflow {
  env?: { TURBO_FORCE?: string };
  jobs: Record<
    string,
    {
      uses?: string;
      with?: { force?: boolean | string };
      steps?: {
        uses?: string;
        run?: string;
        with?: { "server-port"?: number | string };
        env?: {
          CI_TURBO_PROTOCOL_CACHE?: string;
          CI_DEFER_PROTOCOL_MODELS?: string;
        };
      }[];
      strategy?: { matrix?: { check?: string[] } };
    }
  >;
}

async function workflow(name: string) {
  return Bun.YAML.parse(
    await Bun.file(
      `${import.meta.dir}/../../../.github/workflows/${name}.yml`,
    ).text(),
  ) as Workflow;
}

test("nightly CI forces every cacheable lane, including reusable platform workflows", async () => {
  const nightly = await workflow("uncached-tests");
  const { checks } = nightly.jobs;
  expect(checks?.uses).toBe("./.github/workflows/ci.yml");
  expect(checks?.with?.force).toBe(true);
  const ci = await workflow("ci");
  const force =
    "$" + "{{ inputs.force || github.event_name == 'workflow_dispatch' }}";
  expect(ci.env?.TURBO_FORCE).toBe(force);
  for (const name of ["windows", "native"]) {
    const job = ci.jobs[name];
    expect(job?.with?.force).toBe(force);
    const path = job?.uses;
    expect(path).toBeDefined();
    const platform = Bun.YAML.parse(
      await Bun.file(`${import.meta.dir}/../../../${path}`).text(),
    ) as Workflow;
    expect(platform.env?.TURBO_FORCE).toBe(force);
    const steps = Object.values(platform.jobs).flatMap(
      (lane) => lane.steps ?? [],
    );
    expect(
      steps.some(({ uses }) => uses?.startsWith("rharkor/caching-for-turbo@")),
    ).toBe(true);
    expect(steps.some(({ run }) => run?.includes("CI_TOOLCHAIN="))).toBe(true);
  }
});

test("CI opts into cached model checks and native release tests use the shared task", async () => {
  const ci = await workflow("ci");
  const { lint, models } = ci.jobs;
  const steps = lint?.steps ?? [];
  // Lint leaves the TLC passes to the models job, which caches them.
  expect(
    steps.find(({ run }) => run === "bun run check:fast")?.env
      ?.CI_DEFER_PROTOCOL_MODELS,
  ).toBe("1");
  const check = models?.steps?.find(({ run }) =>
    run?.includes("runCachedProtocolCheck.ts"),
  );
  expect(check?.env?.CI_TURBO_PROTOCOL_CACHE).toBe("1");
  expect(models?.strategy?.matrix?.check?.toSorted()).toEqual([
    "check:protocol-models",
    "check:protocol-negative-controls",
  ]);
  expect(
    steps.some(
      ({ run }) =>
        run ===
        "bun scripts/testing/runVerifiedTurbo.ts test --filter=app-capacitor",
    ),
  ).toBe(true);
});

test("every Turbo cache server lets the OS assign its port", async () => {
  // The action's fixed default port is inside Linux's ephemeral range, where an
  // earlier step's outbound socket can already hold it (EADDRINUSE).
  const files = Array.from(
    new Bun.Glob("*.yml").scanSync(
      `${import.meta.dir}/../../../.github/workflows`,
    ),
  );
  const servers = [];
  for (const file of files) {
    const parsed = await workflow(file.replace(/\.yml$/, ""));
    for (const job of Object.values(parsed.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("rharkor/caching-for-turbo@")) {
          servers.push({ file, port: step.with?.["server-port"] });
        }
      }
    }
  }
  expect(servers.length).toBeGreaterThan(0);
  expect(servers.filter(({ port }) => String(port) !== "0")).toEqual([]);
});
