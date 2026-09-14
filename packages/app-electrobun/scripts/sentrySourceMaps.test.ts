import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveElectrobunMainSentryConfig } from "../src/diagnostics/mainSentryConfig";
import {
  electrobunSentryDist,
  electrobunSentryRelease,
  rendererScriptPattern,
  resolveElectrobunSentryConfig,
} from "../src/diagnostics/sentryConfig";
import { createRendererBuildConfig } from "../src/rendererEnvironment";
import {
  desktopSourceMapUploadArgs,
  desktopSourceMapUploadEnv,
  prepareSourceMapStaging,
  stageMainProcessSourceMap,
  stageRendererSourceMap,
  sweepSourceMaps,
  uploadDesktopSourceMaps,
} from "./sentrySourceMaps";

const commit = "b".repeat(40);
const dsn = `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`;

async function withRoot(run: (root: string) => Promise<void>) {
  // Bun writes map sources through symlinks (macOS /var is /private/var); the
  // release resolves a real repository root the same way.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "desktop-sourcemaps-")),
  );
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function listFiles(directory: string, pattern = "**/*") {
  return [
    ...new Bun.Glob(pattern).scanSync({ cwd: directory, dot: true }),
  ].sort();
}

test("a release renderer build stages its chunk with repository-relative sources and the app keeps no map", async () => {
  await withRoot(async (root) => {
    const html = join(root, "packages/x/src/index.html");
    await Bun.write(
      join(root, "packages/x/src/main.ts"),
      "export const answer = () => 42;\nconsole.log(answer());\n",
    );
    await Bun.write(
      html,
      '<!doctype html><html><body><script type="module" src="./main.ts"></script></body></html>',
    );
    const buildDir = join(root, "build/stable");
    const mainViewDir = join(buildDir, "app/views/mainview");
    const stagingDir = join(root, "build/sentry-sourcemaps");
    const config = createRendererBuildConfig({ NODE_ENV: "production" }, html);
    const build = await Bun.build({
      ...config,
      outdir: mainViewDir,
      publicPath: "/",
      sourcemap: "external",
    });
    expect(build.success).toBe(true);
    await prepareSourceMapStaging({ stagingDir, buildDir });
    await stageRendererSourceMap({
      mainViewDir,
      stagingDir,
      outputs: build.outputs,
      repoRoot: root,
      packageRoot: join(root, "packages/x"),
    });
    await sweepSourceMaps(buildDir);
    const staged = listFiles(stagingDir);
    const [chunk = ""] = staged;
    expect(staged).toEqual([chunk, `${chunk}.map`]);
    expect(rendererScriptPattern.test(`/${chunk}`)).toBe(true);
    const packaged = await readFile(join(mainViewDir, chunk), "utf8");
    expect(await readFile(join(stagingDir, chunk), "utf8")).toBe(packaged);
    expect(packaged).not.toContain("sourceMappingURL");
    const mapText = await readFile(join(stagingDir, `${chunk}.map`), "utf8");
    expect(mapText).not.toContain(root);
    const { sources } = JSON.parse(mapText);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(isAbsolute(source)).toBe(false);
      expect(source).not.toContain("..");
      expect(existsSync(resolve(root, source))).toBe(true);
    }
    expect(listFiles(buildDir, "**/*.map")).toEqual([]);
    const unmapped = await Bun.build({
      ...config,
      outdir: join(root, "unmapped"),
      publicPath: "/",
    });
    expect(unmapped.outputs.filter((x) => x.kind === "sourcemap")).toEqual([]);
  });
});

async function writeMainBundle(
  appDir: string,
  bundle: string,
  map: object | undefined,
) {
  await Bun.write(join(appDir, "bun/index.js"), bundle);
  if (map)
    await Bun.write(join(appDir, "bun/index.js.map"), JSON.stringify(map));
}

const mainMap = {
  version: 3,
  sources: ["src/bun/index.ts"],
  sourcesContent: ["export {};\n"],
  mappings: "AAAA",
  names: [],
};

test("main-process map sources resolve against the package root", async () => {
  await withRoot(async (root) => {
    const packageRoot = join(root, "packages/app-electrobun");
    await Bun.write(join(packageRoot, "src/bun/index.ts"), "export {};\n");
    const appDir = join(root, "build/stable/Resources/app");
    await writeMainBundle(appDir, `const release = "${commit}";\n`, mainMap);
    const stagingDir = join(root, "sentry-sourcemaps");
    await prepareSourceMapStaging({ stagingDir, buildDir: appDir });
    await stageMainProcessSourceMap({
      appDir,
      stagingDir,
      commit,
      repoRoot: root,
      packageRoot,
    });
    expect(listFiles(stagingDir)).toEqual(["bun/index.js", "bun/index.js.map"]);
    const staged = JSON.parse(
      await readFile(join(stagingDir, "bun/index.js.map"), "utf8"),
    );
    expect(staged.sources).toEqual([
      "packages/app-electrobun/src/bun/index.ts",
    ]);
  });
});

test("a release build fails, writing nothing, when Electrobun ignored the main-process sourcemap or define", async () => {
  await withRoot(async (root) => {
    const packageRoot = join(root, "packages/app-electrobun");
    await Bun.write(join(packageRoot, "src/bun/index.ts"), "export {};\n");
    const appDir = join(root, "app");
    const stagingDir = join(root, "sentry-sourcemaps");
    await mkdir(stagingDir);
    const stage = (stagedCommit: string | undefined) =>
      stageMainProcessSourceMap({
        appDir,
        stagingDir,
        commit: stagedCommit,
        repoRoot: root,
        packageRoot,
      });
    await writeMainBundle(appDir, `const release = "${commit}";\n`, undefined);
    await expect(stage(commit)).rejects.toThrow(/build\.bun\.sourcemap/);
    expect(await readdir(stagingDir)).toEqual([]);
    for (const [bundle, stagedCommit] of [
      [`const c = TEARLEADS_ELECTROBUN_MAIN_SENTRY; // ${commit}`, commit],
      ["const release = null;", commit],
      [`const release = "${commit}";`, undefined],
    ] as const) {
      await writeMainBundle(appDir, bundle, mainMap);
      await expect(stage(stagedCommit)).rejects.toThrow(/define/);
      expect(await readdir(stagingDir)).toEqual([]);
    }
  });
});

type RendererOutput = Pick<Bun.BuildArtifact, "kind" | "path">;

async function writeRendererFixtures(root: string) {
  const view = join(root, "build/views/mainview");
  await Bun.write(join(root, "src/main.ts"), "export {};\n");
  const map = (sources: string[]) =>
    JSON.stringify({ version: 3, sources, mappings: "", names: [] });
  const files: Record<string, string> = {
    "chunk-a1.js": "a",
    "chunk-a1.js.map": map(["../../../src/main.ts"]),
    "chunk-b2.js": "b",
    "chunk-b2.js.map": map(["../../../src/main.ts"]),
    "assets/chunk-a1.js": "a",
    "assets/chunk-a1.js.map": map(["../../../../src/main.ts"]),
    "chunk-ABC.js": "c",
    "chunk-ABC.js.map": map(["../../../src/main.ts"]),
    "chunk-c3.js": "c",
    "other.js.map": map(["../../../src/main.ts"]),
    "chunk-d4.js": "d",
    "chunk-d4.js.map": map(["/etc/hosts"]),
  };
  for (const [name, content] of Object.entries(files))
    await Bun.write(join(view, name), content);
  return {
    view,
    script: (name: string): RendererOutput => ({
      kind: "entry-point",
      path: join(view, name),
    }),
    sourcemap: (name: string): RendererOutput => ({
      kind: "sourcemap",
      path: join(view, name),
    }),
  };
}

test("unexpected renderer outputs stop staging", async () => {
  await withRoot(async (root) => {
    const { view, script, sourcemap } = await writeRendererFixtures(root);
    const stage = async (name: string, outputs: RendererOutput[]) => {
      const stagingDir = join(root, name);
      await mkdir(stagingDir);
      const staged = stageRendererSourceMap({
        mainViewDir: view,
        stagingDir,
        outputs,
        repoRoot: root,
        packageRoot: root,
      });
      return { stagingDir, staged };
    };
    const cases: Array<[RendererOutput[], RegExp]> = [
      [[sourcemap("chunk-a1.js.map")], /found 0/],
      [
        [
          script("chunk-a1.js"),
          script("chunk-b2.js"),
          sourcemap("chunk-a1.js.map"),
        ],
        /found 2/,
      ],
      [
        [script("assets/chunk-a1.js"), sourcemap("assets/chunk-a1.js.map")],
        /chunk-a1\.js is not the reported script/,
      ],
      [
        [script("chunk-ABC.js"), sourcemap("chunk-ABC.js.map")],
        /chunk-ABC\.js is not the reported script/,
      ],
      [[script("chunk-c3.js")], /chunk-c3\.js\.map beside the renderer chunk/],
      [
        [script("chunk-c3.js"), sourcemap("other.js.map")],
        /chunk-c3\.js\.map beside the renderer chunk/,
      ],
      [
        [script("chunk-d4.js"), sourcemap("chunk-d4.js.map")],
        /outside the repository/,
      ],
    ];
    for (const [index, [outputs, message]] of cases.entries()) {
      const { stagingDir, staged } = await stage(`staging-${index}`, outputs);
      await expect(staged).rejects.toThrow(message);
      expect(await readdir(stagingDir)).toEqual([]);
    }
    // The same fixtures stage when valid, so each rejection is its own guard.
    const valid = await stage("staging-valid", [
      script("chunk-a1.js"),
      sourcemap("chunk-a1.js.map"),
    ]);
    await valid.staged;
    expect((await readdir(valid.stagingDir)).sort()).toEqual([
      "chunk-a1.js",
      "chunk-a1.js.map",
    ]);
  });
});

test("staging refuses a relative, misnamed, pre-existing, or in-build directory", async () => {
  await withRoot(async (root) => {
    const buildDir = join(root, "build/stable");
    const existing = join(root, "existing/sentry-sourcemaps");
    await Bun.write(join(existing, "keep.txt"), "keep");
    for (const stagingDir of [
      "build/sentry-sourcemaps",
      join(root, "build/maps"),
      existing,
      join(buildDir, "sentry-sourcemaps"),
      join(buildDir, "..hidden/sentry-sourcemaps"),
    ])
      await expect(
        prepareSourceMapStaging({ stagingDir, buildDir }),
      ).rejects.toThrow(/Refusing to stage/);
    expect(await readFile(join(existing, "keep.txt"), "utf8")).toBe("keep");
    const stagingDir = join(root, "build/sentry-sourcemaps");
    await prepareSourceMapStaging({ stagingDir, buildDir });
    expect(await readdir(stagingDir)).toEqual([]);
  });
});

test("the sweep deletes every map under the build directory, including hidden directories", async () => {
  await withRoot(async (root) => {
    for (const path of [
      "app/bun/index.js",
      "app/bun/index.js.map",
      "app/views/mainview/worker.js",
      "app/views/mainview/chunk-a1.js.map",
      ".x/hidden.js.map",
    ])
      await Bun.write(join(root, path), "content");
    await sweepSourceMaps(root);
    expect(listFiles(root)).toEqual([
      "app/bun/index.js",
      "app/views/mainview/worker.js",
    ]);
  });
});

async function stagePairs(stagingDir: string, extra: string[] = []) {
  for (const path of [
    "bun/index.js",
    "bun/index.js.map",
    "chunk-a1.js",
    "chunk-a1.js.map",
    ...extra,
  ])
    await Bun.write(join(stagingDir, path), "content");
}

test("upload runs once over exactly the staged pairs and always removes the staging directory", async () => {
  await withRoot(async (root) => {
    const stagingDir = join(root, "sentry-sourcemaps");
    let calls = 0;
    const cases: [string[], () => Promise<number>, RegExp | undefined][] = [
      [[], async () => 0, undefined],
      [[], async () => 1, /upload failed/],
      [
        [],
        async () => {
          throw new Error("spawn failed");
        },
        /spawn failed/,
      ],
    ];
    for (const [extra, upload, failure] of cases) {
      await stagePairs(stagingDir, extra);
      calls = 0;
      const run = uploadDesktopSourceMaps(stagingDir, () => {
        calls += 1;
        return upload();
      });
      if (failure) await expect(run).rejects.toThrow(failure);
      else await run;
      expect(calls).toBe(1);
      expect(existsSync(stagingDir)).toBe(false);
    }
    await stagePairs(stagingDir, ["worker.js"]);
    const unexpected = async () => {
      calls += 1;
      return 0;
    };
    calls = 0;
    await expect(
      uploadDesktopSourceMaps(stagingDir, unexpected),
    ).rejects.toThrow(/Unexpected/);
    expect(existsSync(stagingDir)).toBe(false);
    await expect(
      uploadDesktopSourceMaps(stagingDir, unexpected),
    ).rejects.toThrow(/Unexpected/);
    expect(calls).toBe(0);
  });
});

test("the upload child env admits no inherited Sentry, proxy, or dotenv override", () => {
  expect(
    desktopSourceMapUploadEnv(
      {
        PATH: "/usr/bin",
        HOME: "/home/release",
        TMPDIR: "/tmp/release",
        SENTRY_URL: "https://sentry.invalid",
        SENTRY_ALLOW_FAILURE: "1",
        SENTRY_PROPERTIES: "/tmp/sentry.properties",
        SENTRY_DOTENV_PATH: "/tmp/.env",
        https_proxy: "http://proxy.invalid",
        HTTP_PROXY: "http://proxy.invalid",
        SENTRY_AUTH_TOKEN: "ambient",
      },
      "upload-token",
    ),
  ).toEqual({
    PATH: "/usr/bin",
    HOME: "/home/release",
    TMPDIR: "/tmp/release",
    SENTRY_AUTH_TOKEN: "upload-token",
    SENTRY_DISABLE_UPDATE_CHECK: "1",
    SENTRY_LOAD_DOTENV: "0",
  });
});

test("upload arguments carry the runtime release and dist", () => {
  const release = electrobunSentryRelease(commit);
  const dist = electrobunSentryDist("staging");
  expect(
    desktopSourceMapUploadArgs({
      org: "tearleads",
      project: "tearleads-electrobun-staging",
      release,
      dist,
      directory: "build/sentry-sourcemaps",
    }),
  ).toEqual([
    "sourcemaps",
    "upload",
    "--org",
    "tearleads",
    "--project",
    "tearleads-electrobun-staging",
    "--release",
    `tearleads-electrobun@${commit}`,
    "--dist",
    "staging-app",
    "--url-prefix",
    "app:///",
    "--validate",
    "--strict",
    "--wait-for",
    "60",
    "build/sentry-sourcemaps",
  ]);
  const renderer = resolveElectrobunSentryConfig({
    dsn,
    environment: "staging",
    commit,
    origin: "http://127.0.0.1:3002",
    scriptUrl: "http://127.0.0.1:3002/chunk-a1.js",
  });
  const main = resolveElectrobunMainSentryConfig({
    dsn,
    environment: "staging",
    commit,
    moduleUrl: pathToFileURL(
      "/Applications/T.app/Contents/Resources/app/bun/index.js",
    ).href,
  });
  for (const config of [renderer, main]) {
    expect(config?.release).toBe(release);
    expect(config?.dist).toBe(dist);
  }
});
