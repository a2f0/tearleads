import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  assertStagedSourceMaps,
  prepareSourceMapStaging,
  stageMainProcessSourceMap,
  stageRendererSourceMap,
} from "./sentrySourceMaps";

// Runs on the Windows Actions runner as well as locally: native path.relative
// emits backslashes there, but Sentry's self-contained maps require URL paths.
test("Windows release maps stage and validate with portable repository paths", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "windows-map-staging-")),
  );
  try {
    const commit = "a".repeat(40);
    const packageRoot = join(root, "packages/app-electrobun");
    const source = join(packageRoot, "src/index.ts");
    await Bun.write(source, "export {};\n");
    const appDir = join(root, "build/canary-win-x64/Resources/app");
    const view = join(appDir, "views/mainview");
    const main = join(appDir, "bun/index.js");
    const renderer = join(view, "chunk-a1b2c3.js");
    const map = (base: string) =>
      JSON.stringify({
        version: 3,
        sources: [relative(base, source)],
        sourcesContent: ["export {};\n"],
        mappings: "",
        names: [],
      });
    await Bun.write(
      main,
      `const commit = "${commit}"; const target = "win-x64";`,
    );
    await Bun.write(`${main}.map`, map(packageRoot));
    await Bun.write(renderer, "console.log('renderer');");
    await Bun.write(`${renderer}.map`, map(view));
    const stagingRoot = join(root, "build/sentry-sourcemaps");
    const stagingDir = join(stagingRoot, "staging-app-win-x64");
    await prepareSourceMapStaging({
      stagingDir: stagingRoot,
      buildDir: appDir,
    });
    await stageMainProcessSourceMap({
      appDir,
      stagingDir,
      commit,
      target: "win-x64",
      repoRoot: root,
      packageRoot,
    });
    await stageRendererSourceMap({
      mainViewDir: view,
      stagingDir,
      outputs: [
        { path: renderer, kind: "entry-point" },
        { path: `${renderer}.map`, kind: "sourcemap" },
      ],
      repoRoot: root,
      packageRoot,
    });
    expect(
      assertStagedSourceMaps(stagingRoot, {
        environment: "staging",
        target: "win-x64",
      }),
    ).toBe("staging-app-win-x64");
    for (const file of ["bun/index.js.map", "chunk-a1b2c3.js.map"]) {
      const staged = await Bun.file(join(stagingDir, file)).json();
      expect(staged.sources).toEqual(["packages/app-electrobun/src/index.ts"]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
