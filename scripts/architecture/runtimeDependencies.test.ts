import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import dependencyCruiserConfig from "../../dependency-cruiser.config";
import { workspaceRegistry } from "../workspaceRegistry";

const cruiserBin = resolve(
  import.meta.dir,
  "../../node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
);

test("runtime dependency policy covers every lane and preserves test/type imports", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "tearleads-runtime-deps-"));
  try {
    const rule = dependencyCruiserConfig.forbidden.find(
      (candidate) => candidate.name === "not-to-dev-dep",
    );
    expect(rule).toBeDefined();
    await Bun.write(join(fixture, "package.json"), '{"private":true}');
    await Bun.write(
      join(fixture, "rules.json"),
      JSON.stringify({
        forbidden: [rule],
        options: {
          doNotFollow: { path: "node_modules" },
          tsPreCompilationDeps: "specify",
        },
      }),
    );
    for (const name of ["dev-only", "prod-only"]) {
      await Bun.write(
        join(fixture, `node_modules/${name}/package.json`),
        JSON.stringify({
          name,
          version: "1.0.0",
          main: "index.js",
          types: "index.d.ts",
        }),
      );
      await Bun.write(
        join(fixture, `node_modules/${name}/index.js`),
        "exports.value = 1;",
      );
      await Bun.write(
        join(fixture, `node_modules/${name}/index.d.ts`),
        "export interface Value { value: number }",
      );
    }
    const expected = [];
    for (const workspace of workspaceRegistry) {
      const workspacePath = `packages/${workspace.directory}`;
      await Bun.write(
        join(fixture, workspacePath, "package.json"),
        JSON.stringify({
          name: workspace.packageName,
          dependencies: { "prod-only": "1.0.0" },
          devDependencies: { "dev-only": "1.0.0" },
        }),
      );
      for (const [file, source] of Object.entries({
        "production.ts":
          'import { value } from "prod-only"; console.log(value);',
        "runtime.ts": 'import { value } from "dev-only"; console.log(value);',
        "dynamic.ts": 'void import("dev-only").then(console.log);',
        "types.ts":
          'import type { Value } from "dev-only"; export type Result = Value;',
        "env.d.ts": '/// <reference types="dev-only" />',
        "runtime.test.ts": 'import "dev-only";',
        "runtime.testUtils.ts": 'import "dev-only";',
        "runtime.testFixtures.ts": 'import "dev-only";',
        "test/helper.ts": 'import "dev-only";',
      })) {
        await Bun.write(join(fixture, workspacePath, "src", file), source);
      }
      if (workspace.role !== "test-support") {
        expected.push(
          `${workspacePath}/src/runtime.ts`,
          `${workspacePath}/src/dynamic.ts`,
        );
      }
    }
    const result = Bun.spawnSync(
      [
        process.execPath,
        cruiserBin,
        "--config",
        "rules.json",
        "--output-type",
        "json",
        "packages",
      ],
      { cwd: fixture, stdout: "pipe", stderr: "pipe" },
    );
    // The JSON reporter returns the graph; assert its error set below.
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const report = JSON.parse(result.stdout.toString()) as {
      summary: {
        violations: {
          from: string;
          rule: { name: string; severity: string };
        }[];
      };
    };
    expect(
      report.summary.violations.map((violation) => violation.from).sort(),
    ).toEqual(expected.sort());
    expect(
      report.summary.violations.every(
        (violation) =>
          violation.rule.name === "not-to-dev-dep" &&
          violation.rule.severity === "error",
      ),
    ).toBe(true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 60_000);
