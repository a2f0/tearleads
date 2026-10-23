import { expect, test } from "bun:test";

interface PublishStep {
  name?: string;
  if?: string;
  run?: string;
}

for (const name of ["client-sdk", "windowing"]) {
  test(`${name} plans with the pinned tool before its guarded publish`, async () => {
    const root = `${import.meta.dir}/../..`;
    const workflow = Bun.YAML.parse(
      await Bun.file(`${root}/.github/workflows/${name}-publish.yml`).text(),
    ) as {
      jobs: {
        publish: {
          if: string;
          environment: string;
          permissions: Record<string, string>;
          steps: PublishStep[];
        };
      };
    };
    const { publish } = workflow.jobs;
    expect(publish.if).toBe("github.ref == 'refs/heads/main'");
    expect(publish.environment).toBe("npm");
    expect(publish.permissions["id-token"]).toBe("write");
    const install = publish.steps.findIndex(
      (step) => step.name === "Install dependencies",
    );
    const plan = publish.steps.findIndex(
      (step) => step.name === "Decide whether to publish",
    );
    const upload = publish.steps.findIndex(
      (step) => step.name === "Publish to npm",
    );
    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(plan);
    expect(publish.steps[install]?.if).toBeUndefined();
    expect(publish.steps[install]?.run).toBe("bun install --frozen-lockfile");
    expect(publish.steps[plan]?.run).toBe(
      `bun run agent-tool release plan packages/${name}/package.json --allow-private-source --github-output`,
    );
    expect(upload).toBeGreaterThan(plan);
    expect(publish.steps[upload]?.if).toBe(
      "steps.decide.outputs.publish == 'true'",
    );
    expect(publish.steps[upload]?.run).toBe(
      `bash scripts/release/publishNpmPackage.sh ${name}`,
    );
    if (name === "client-sdk") {
      const smoke = publish.steps.findIndex(
        (step) => step.name === "Smoke test the package",
      );
      expect(smoke).toBeGreaterThan(plan);
      expect(smoke).toBeLessThan(upload);
      expect(publish.steps[smoke]?.if).toBe(
        "steps.decide.outputs.publish == 'true'",
      );
    }
  });
}
