import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertStagedSourceMaps } from "./sentrySourceMaps";
import {
  minimalSourceMap,
  repositoryRelativeSources,
  stageMinimalPairs,
} from "./sentryStagedMaps.testUtils";

const dist = "staging-app-linux-x64";
const nul = String.fromCharCode(0);
let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function staged(options: { map?: string; script?: string } = {}) {
  root = await realpath(await mkdtemp(join(tmpdir(), "staged-map-contents-")));
  const stagingDir = join(root, "sentry-sourcemaps");
  await stageMinimalPairs(join(stagingDir, dist));
  const chunk = join(stagingDir, dist, "chunk-a1.js");
  if (options.map !== undefined) await writeFile(`${chunk}.map`, options.map);
  if (options.script !== undefined) await writeFile(chunk, options.script);
  return stagingDir;
}

const map = (fields: Record<string, unknown>) =>
  JSON.stringify({ ...JSON.parse(minimalSourceMap), ...fields });
const source = (path: unknown) => map({ sources: [path] });

test.each([
  ["no JSON", "content"],
  ["an array", "[]"],
  ["another version", map({ version: 2 })],
  [
    "index sections",
    JSON.stringify({
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: JSON.parse(minimalSourceMap) },
      ],
    }),
  ],
  ["an empty sourceRoot", map({ sourceRoot: "" })],
  ["a sourceRoot", map({ sourceRoot: "src/" })],
  ["no sources", map({ sources: undefined })],
  ["a non-string source", source(1)],
  ["no sourcesContent", map({ sourcesContent: undefined })],
  ["fewer contents than sources", map({ sources: ["src/a.ts", "src/b.ts"] })],
  ["null content", map({ sourcesContent: [null] })],
  ["non-string content", map({ sourcesContent: [1] })],
  ["an absolute source", source("/etc/hosts")],
  ["a parent source", source("../src/main.ts")],
  ["a nested parent source", source("src/../../main.ts")],
  ["a bare parent source", source("..")],
  ["a dot source", source("./src/main.ts")],
  ["an empty segment", source("src//main.ts")],
  ["an empty source", source("")],
  ["a file URL source", source("file:///etc/hosts")],
  ["an https source", source("https://example.invalid/main.ts")],
  ["a webpack source", source("webpack://app/src/main.ts")],
  ["a drive source", source("C:/src/main.ts")],
  ["a backslash source", source("src\\main.ts")],
  ["a NUL source", source(`src/main.ts${nul}`)],
])("a staged map with %s is refused", async (_name, contents) => {
  const stagingDir = await staged({ map: contents });
  expect(() =>
    assertStagedSourceMaps(stagingDir, { environment: "staging" }),
  ).toThrow(
    /Staged source map chunk-a1\.js\.map .*release must not be published/,
  );
});

test.each([
  "//# sourceMappingURL=other.js.map",
  "//# sourceMappingURL=../chunk-a1.js.map",
  "//# sourceMappingURL=/tmp/chunk-a1.js.map",
  "//# sourceMappingURL=file:///tmp/chunk-a1.js.map",
  "//# sourceMappingURL=data:application/json;base64,e30=",
  "//# sourceMappingURL=",
  "//@ sourceMappingURL=other.js.map",
  "  //# sourceMappingURL = other.js.map",
  "/*# sourceMappingURL=other.js.map */",
  "//# sourceMappingURL=chunk-a1.js.map\r//# sourceMappingURL=other.js.map",
])("a staged script referencing %j is refused", async (reference) => {
  const stagingDir = await staged({
    script: `console.log(1);\n${reference}\n`,
  });
  expect(() =>
    assertStagedSourceMaps(stagingDir, { environment: "staging" }),
  ).toThrow(
    /Staged script chunk-a1\.js names a source map other than chunk-a1\.js\.map/,
  );
});

test.each([
  "console.log(1);\n",
  "console.log(1);\n//# sourceMappingURL=chunk-a1.js.map\n",
  "console.log(1);\n/*# sourceMappingURL=chunk-a1.js.map */\n",
  "console.log('//# sourceMappingURL=elsewhere.js.map');\n",
])("a staged script %j with its own map is accepted", async (script) => {
  const stagingDir = await staged({ script });
  expect(assertStagedSourceMaps(stagingDir, { environment: "staging" })).toBe(
    dist,
  );
});

test("the main-process bundle may name only its own index.js.map", async () => {
  const stagingDir = await staged();
  const bundle = join(stagingDir, dist, "bun/index.js");
  await writeFile(
    bundle,
    "console.log(1);\n//# sourceMappingURL=index.js.map\n",
  );
  expect(assertStagedSourceMaps(stagingDir, { environment: "staging" })).toBe(
    dist,
  );
  await writeFile(
    bundle,
    "console.log(1);\n//# sourceMappingURL=bun/index.js.map\n",
  );
  expect(() =>
    assertStagedSourceMaps(stagingDir, { environment: "staging" }),
  ).toThrow(/Staged script index\.js/);
});

test("Bun's maps pass once their sources are repository-relative, as the packaging hook stages them", async () => {
  const stagingDir = await staged();
  await Bun.write(
    join(root, "src/renderer.ts"),
    "export const title = () => document.title;\nconsole.log(title());\n",
  );
  const build = await Bun.build({
    entrypoints: [join(root, "src/renderer.ts")],
    outdir: join(stagingDir, dist),
    naming: "chunk-a1.js",
    target: "browser",
    sourcemap: "external",
  });
  expect(build.success).toBe(true);
  const chunkMap = join(stagingDir, dist, "chunk-a1.js.map");
  expect(JSON.parse(await readFile(chunkMap, "utf8")).sources).toEqual([
    "../../src/renderer.ts",
  ]);
  expect(() =>
    assertStagedSourceMaps(stagingDir, { environment: "staging" }),
  ).toThrow(/not a repository-relative path/);
  await repositoryRelativeSources(chunkMap, root);
  expect(assertStagedSourceMaps(stagingDir, { environment: "staging" })).toBe(
    dist,
  );
});
