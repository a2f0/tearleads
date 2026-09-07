import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import knipConfig from "../../../knip.config";

const knipBin = resolve(
  import.meta.dir,
  "../../../node_modules/knip/bin/knip.js",
);

test("production roots retain runtime code but reject test-only modules", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "tearleads-knip-"));
  try {
    const production = await knipConfig({ production: true });
    const files = {
      "package.json": JSON.stringify({
        name: "production-reachability-fixture",
        private: true,
        workspaces: ["packages/*"],
      }),
      "knip.json": JSON.stringify({
        ...production,
        include: ["files"],
        workspaces: {
          ".": { entry: [], project: [] },
          "packages/api": production.workspaces["packages/api"],
          "packages/client-sdk": production.workspaces["packages/client-sdk"],
        },
      }),
      "packages/api/package.json": JSON.stringify({
        name: "fixture-api",
        scripts: { start: "bun src/index.ts", test: "bun test src" },
      }),
      "packages/api/src/index.ts": 'import "./server";',
      "packages/api/src/server.ts": 'console.log("server");',
      "packages/api/scripts/blobGc.ts": 'console.log("gc");',
      "packages/api/scripts/stripeSeatSync.ts": 'console.log("seats");',
      "packages/api/src/testOnly.ts": "export const unused = 1;",
      "packages/api/src/consumer.test.ts": 'import "./testOnly";',
      "packages/api/src/helper.testUtils.ts": "export const fixture = 1;",
      "packages/client-sdk/package.json": JSON.stringify({
        name: "fixture-sdk",
        exports: { ".": "./dist/index.js", "./sqlite": "./dist/sqlite.js" },
      }),
      "packages/client-sdk/src/index.ts":
        'export { publicApi } from "./public";',
      "packages/client-sdk/src/public.ts": "export const publicApi = 1;",
      "packages/client-sdk/src/sqlite.ts": "export const sqlite = 1;",
      "packages/client-sdk/src/testOnly.ts": "export const unused = 1;",
      "packages/client-sdk/src/consumer.test.ts": 'import "./testOnly";',
    };
    for (const [path, content] of Object.entries(files)) {
      await Bun.write(join(fixture, path), content);
    }
    const result = Bun.spawnSync(
      [process.execPath, knipBin, "--production", "--reporter", "json"],
      { cwd: fixture, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout.toString()) as {
      issues: { file: string; files: unknown[] }[];
    };
    expect(
      report.issues
        .filter((issue) => issue.files.length > 0)
        .map((issue) => issue.file)
        .sort(),
    ).toEqual([
      "packages/api/src/testOnly.ts",
      "packages/client-sdk/src/testOnly.ts",
    ]);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
