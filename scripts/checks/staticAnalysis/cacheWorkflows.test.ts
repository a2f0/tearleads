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
        env?: { CI_TURBO_PROTOCOL_CACHE?: string };
      }[];
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
  const { lint } = ci.jobs;
  const steps = lint?.steps ?? [];
  expect(
    steps.find(({ run }) => run === "bun run check:fast")?.env
      ?.CI_TURBO_PROTOCOL_CACHE,
  ).toBe("1");
  expect(
    steps.some(
      ({ run }) =>
        run ===
        "bun scripts/testing/runVerifiedTurbo.ts test --filter=app-capacitor",
    ),
  ).toBe(true);
});
