import { expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import {
  createRepository,
  fixtureDsn,
  orgAuthToken,
  privateTempBase,
} from "./sentrySourceMapUpload.testUtils";
import { linuxUploadHarness } from "./uploadLinuxSourceMaps.testUtils";

const packageRoot = resolve(import.meta.dirname, "..");
const origin = "http://127.0.0.1:3002";
const chunk = "chunk-a1b2c3.js";
const modulePath = (path: string) => JSON.stringify(join(packageRoot, path));

// Stands in for Hutch and the packaging hook building one target
// (<os> <arch> <app directory>): Hutch's own ELECTROBUN_OS and ELECTROBUN_ARCH
// over the wrapper's environment, the release defines, the real staging dist,
// external maps with relative sources (from the filesystem root, as the probes
// bundle this package's modules), and an app holding only the two scripts. The renderer's
// browser client and script URL are stubbed so the chunk can run in a context.
const hutchScript = `import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createMainProcessSentryDefine, createRendererBuildConfig } from ${modulePath("src/rendererEnvironment.ts")};
import { hutchSourceMapIdentity } from ${modulePath("scripts/sentrySourceMaps.ts")};
import { repositoryRelativeSources } from ${modulePath("scripts/sentryStagedMaps.testUtils.ts")};
const [os, arch, app] = process.argv.slice(2);
const env = { ...process.env, ELECTROBUN_OS: os, ELECTROBUN_ARCH: arch };
const staging = join(env.TEARLEADS_ELECTROBUN_SOURCEMAP_DIR, hutchSourceMapIdentity(env).dist);
const client = { name: "browser-client", setup(build) {
  build.onResolve({ filter: /^@tearleads\\/diagnostics\\/browser$/u }, (args) => ({ path: args.path, namespace: "stub" }));
  build.onLoad({ filter: /.*/u, namespace: "stub" }, () => ({ loader: "js", contents: "export const createBrowserDiagnostics = (config) => (globalThis.reported = config);" }));
} };
const renderer = createRendererBuildConfig(env, join(import.meta.dirname, "renderer.ts"));
for (const [options, naming, packaged] of [
  [{ entrypoints: [join(import.meta.dirname, "main.ts")], target: "bun", define: createMainProcessSentryDefine(env) }, "bun/index.js", "Resources/app/bun/index.js"],
  [{ ...renderer, define: { ...renderer.define, "import.meta.url": ${JSON.stringify(JSON.stringify(`${origin}/${chunk}`))} }, plugins: [client] }, "${chunk}", "Resources/app/views/mainview/${chunk}"],
]) {
  const build = await Bun.build({ ...options, outdir: staging, naming, sourcemap: "external" });
  if (!build.success) throw new AggregateError(build.logs);
  await repositoryRelativeSources(join(staging, naming + ".map"), "/");
  await mkdir(dirname(join(app, packaged)), { recursive: true });
  await copyFile(join(staging, naming), join(app, packaged));
}
`;

// The shipped entrypoints' diagnostics: the main process reports one error
// through its real client, whose transport prints the envelope.
const mainProbe = `import { configureMainProcessDiagnostics } from ${modulePath("src/diagnostics/mainProcess.ts")};
globalThis.fetch = async (_url, init) => { console.log(String(init?.body)); return new Response(null, { status: 200 }); };
const reporter = configureMainProcessDiagnostics(import.meta.url);
reporter?.captureError(new Error("probe"), "request-error");
await reporter?.flush();
process.exit(0);
`;
const rendererProbe = `import { configureElectrobunSentry } from ${modulePath("src/diagnostics/sentry.ts")};
configureElectrobunSentry();
`;
const releaseHarness = `import { runDesktopSentryRelease } from ${modulePath("scripts/withSentryReleaseEnv.ts")};
const [intended, packageRoot, repoRoot, ...command] = process.argv.slice(2);
const root = new URL(intended).origin + "/";
process.exit(await runDesktopSentryRelease({
  packageRoot, repoRoot, command: [process.execPath, ...command], env: process.env,
  endpoint: { url: root, isAllowed: (url) => url.href === root },
}));
`;

async function run(cwd: string, args: string[], env: Record<string, string>) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(0);
  return stdout;
}

// The artifact bundle the fake Sentry last assembled.
function uploaded(bundlePath: string) {
  const read = (name: string) => {
    const unzip = Bun.spawnSync(["unzip", "-p", bundlePath, name]);
    expect(unzip.exitCode).toBe(0);
    return unzip.stdout.toString();
  };
  const manifest: {
    release: string;
    dist: string;
    files: Record<string, { url: string }>;
  } = JSON.parse(read("manifest.json"));
  return {
    release: manifest.release,
    dist: manifest.dist,
    urls: Object.values(manifest.files)
      .map(({ url }) => url)
      .sort(),
    main: read("files/app/_/bun/index.js"),
  };
}

// What each packaged script reports at runtime.
async function runtime(root: string, app: string) {
  const { PATH = "" } = process.env;
  const main = join(app, "Resources/app/bun/index.js");
  const lines = (await run(root, [main], { PATH })).split("\n");
  const event = lines
    .filter((line) => line.startsWith("{"))
    .map((line): { dist?: string } => JSON.parse(line))
    .find(({ dist }) => dist);
  // A vm context has only the language globals; a WebView also has URL.
  const context: {
    URL: typeof URL;
    window: { location: { origin: string } };
    reported?: { dist?: string };
  } = { URL, window: { location: { origin } } };
  const view = join(app, "Resources/app/views/mainview", chunk);
  runInNewContext(await Bun.file(view).text(), context);
  return {
    dists: { main: event?.dist, renderer: context.reported?.dist },
    packagedMain: await Bun.file(main).text(),
  };
}

function archiveCommit(repoRoot: string, archive: string) {
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (name.startsWith("GIT_")) delete env[name];
  execFileSync(
    "sh",
    [
      "-c",
      'git -C "$1" archive HEAD | tar -x -C "$2"',
      "sh",
      repoRoot,
      archive,
    ],
    { env },
  );
}

// Releases one commit twice against the fake Sentry at `intended`: a checkout
// builds macos-arm64 and its wrapper uploads; a source archive of that commit
// builds linux-x64 and defers, and the host uploads a copy of its staging.
export async function runPlatformReleases(
  intended: string,
  bundlePath: string,
) {
  const base = await privateTempBase();
  const root = await realpath(await mkdtemp(join(base, "platform-releases-")));
  const tmp = await realpath(await mkdtemp(join(base, "platform-tmp-")));
  const at = (name: string) => join(root, name);
  try {
    const repoRoot = at("repo");
    await createRepository(repoRoot, orgAuthToken(intended));
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    for (const [name, source] of Object.entries({
      "hutch.ts": hutchScript,
      "main.ts": mainProbe,
      "renderer.ts": rendererProbe,
      "release.ts": releaseHarness,
      "linux.ts": linuxUploadHarness(
        join(import.meta.dirname, "uploadDeferredSourceMaps.ts"),
      ),
    }))
      await Bun.write(at(name), source);
    const { PATH = "" } = process.env;
    const env = { PATH, HOME: root, TMPDIR: tmp, NODE_ENV: "production" };
    const tier = { ...env, ELECTROBUN_RELEASE_TIER: "staging" };
    const app = join(repoRoot, "packages/app");
    await run(
      root,
      [
        at("release.ts"),
        intended,
        app,
        repoRoot,
        at("hutch.ts"),
        "macos",
        "arm64",
        at("macos"),
      ],
      tier,
    );
    const macos = uploaded(bundlePath);
    const archive = at("archive");
    await mkdir(archive);
    archiveCommit(repoRoot, archive);
    await run(
      root,
      [
        at("release.ts"),
        intended,
        join(archive, "packages/app"),
        archive,
        at("hutch.ts"),
        "linux",
        "x64",
        at("linux"),
      ],
      {
        ...tier,
        TEARLEADS_ELECTROBUN_SOURCEMAP_UPLOAD: "deferred",
        BUILD_GIT_SHA: head,
        SENTRY_ELECTROBUN_STAGING_DSN: fixtureDsn,
      },
    );
    const copied = at("copied/sentry-sourcemaps");
    await cp(join(archive, "packages/app/build/sentry-sourcemaps"), copied, {
      recursive: true,
    });
    await run(
      root,
      [
        at("linux.ts"),
        intended,
        repoRoot,
        "staging",
        "linux-x64",
        head,
        copied,
      ],
      env,
    );
    const linux = uploaded(bundlePath);
    return {
      head,
      macos: { uploaded: macos, ...(await runtime(root, at("macos"))) },
      linux: { uploaded: linux, ...(await runtime(root, at("linux"))) },
    };
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
  }
}
