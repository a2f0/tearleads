import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findPackagedMainViewDir } from "./findPackagedMainViewDir";
import { assertStagedSourceMaps } from "./sentrySourceMaps";
import { verifyMacosDmg } from "./verifyMacosDmg";
import { verifyPublishedRelease } from "./verifyPublishedRelease";

if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error(
    "Release packaging integration requires an Apple silicon Mac",
  );

const packageRoot = resolve(import.meta.dirname, "..");
const root = await mkdtemp(join(tmpdir(), "tearleads-release-packaging-"));
const configPath = join(root, "electrobun.config.ts");
const artifacts = join(root, "build/artifacts");
const signingProbe = join(root, "signing-invoked");
const stagedMaps = join(root, "build/sentry-sourcemaps");
const probeCommit = "b".repeat(40);
const stagingNameProbe = process.argv.includes("--staging");
const channel = stagingNameProbe ? "canary" : "stable";
const artifactAppName = stagingNameProbe
  ? "TLStaging-canary"
  : "PackagingProbe";
const bundleName = stagingNameProbe ? "TL Staging-canary" : "PackagingProbe";
const originalConfig = JSON.stringify(
  join(packageRoot, "electrobun.config.ts"),
);
const originalHook = JSON.stringify(join(import.meta.dirname, "postBuild.ts"));
const {
  HOME: inheritedHome,
  TMPDIR: inheritedTmp,
  PATH: inheritedPath,
} = process.env;
const env = {
  HOME: inheritedHome,
  TMPDIR: inheritedTmp,
  PATH: `${root}/bin:${inheritedPath}`,
  NODE_ENV: "production",
  DASH_RELEASE_OFFLINE: "1",
  ELECTROBUN_DEVELOPER_ID: "-",
  PACKAGING_SIGN_PROBE: signingProbe,
  ...(stagingNameProbe ? { ELECTROBUN_RELEASE_TIER: "staging" } : {}),
  // A release tier's diagnostics: this is the only proof that Hutch applies
  // build.bun.sourcemap and define and that no map is sealed into the app.
  TEARLEADS_ELECTROBUN_SOURCEMAP_DIR: stagedMaps,
  BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT: probeCommit,
  BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: `https://${"a".repeat(32)}@o1.ingest.us.sentry.io/1`,
  BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT: "staging",
};

async function config(fail: boolean) {
  await Bun.write(
    configPath,
    `
import original from ${originalConfig};
export default {
  ...original,
  app: ${stagingNameProbe ? "original.app" : '{ ...original.app, name: "PackagingProbe" }'},
  build: { ...original.build, mac: { ...original.build.mac, icons: undefined, codesign: true, notarize: false } },
  scripts: { ...original.scripts, postBuild: ${JSON.stringify(fail ? "rejectPostBuild.ts" : "recordPostBuild.ts")} },
};
`,
  );
}

async function verifySourceMapStaging(archive: string, unpacked: string) {
  const listing = Bun.spawn(["tar", "-tf", archive], { stdout: "pipe" });
  const entries = (await new Response(listing.stdout).text()).split("\n");
  assert.equal(await listing.exited, 0);
  assert.deepEqual(
    entries.filter((entry) => entry.endsWith(".map")),
    [],
    "No source map may enter the update archive",
  );
  // Hutch builds macos-arm64 here, so the staging tier stages under that dist.
  const dist = "staging-app-macos-arm64";
  const staged = [
    ...new Bun.Glob("**/*").scanSync({ cwd: stagedMaps, dot: true }),
  ].sort();
  assert.equal(staged.length, 4, staged.join(", "));
  assert.deepEqual(staged.slice(0, 2), [
    `${dist}/bun/index.js`,
    `${dist}/bun/index.js.map`,
  ]);
  assert.match(
    staged[2] ?? "",
    /^staging-app-macos-arm64\/chunk-[a-z0-9]+\.js$/u,
  );
  assert.equal(staged[3], `${staged[2]}.map`);
  const [bundle] = [
    ...new Bun.Glob("**/Resources/app/bun/index.js").scanSync({
      cwd: unpacked,
    }),
  ];
  const main = await Bun.file(join(unpacked, bundle ?? "missing")).text();
  assert.ok(main.includes(probeCommit), "Main process must inline its commit");
  assert.ok(
    main.includes('"macos-arm64"'),
    "Main process must inline its target",
  );
  assert.equal(main.includes("TEARLEADS_ELECTROBUN_MAIN_SENTRY"), false);
  assert.equal(main.includes("TEARLEADS_ELECTROBUN_APP_NAME"), false);
  assert.ok(main.includes(stagingNameProbe ? '"TL Staging"' : '"Tearleads"'));
  // The real pairs need no other file to upload: embedded, repository-relative
  // sources and no foreign map reference.
  assert.equal(
    assertStagedSourceMaps(stagedMaps, {
      environment: "staging",
      target: "macos-arm64",
    }),
    dist,
  );
  await rm(stagedMaps, { recursive: true, force: true });
  console.log("Source maps are staged outside the app and absent from it.");
}

async function build(channel: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--bun",
      "run",
      "electrobun",
      "build",
      `--env=${channel}`,
    ],
    {
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, output: `${stdout}\n${stderr}` };
}

try {
  // Hutch rejects a symlinked .hutch (InvalidProjectStatePath) and projects a
  // devkit under the temporary root, outside the repository. The main-process
  // map's devkit sources then resolve only against the package's projection.
  const sync = Bun.spawn(
    [process.execPath, "--bun", "run", "electrobun", "sync"],
    { cwd: packageRoot, env, stdout: "ignore", stderr: "inherit" },
  );
  assert.equal(await sync.exited, 0, "The package devkit must be projected");
  for (const name of ["node_modules", "src", "scripts"])
    await symlink(join(packageRoot, name), join(root, name));
  for (const name of ["package.json", "hutch.config.ts"])
    await cp(join(packageRoot, name), join(root, name));
  await mkdir(join(root, "bin"));
  await Bun.write(
    join(root, "bin/codesign"),
    '#!/bin/sh\necho invoked > "$PACKAGING_SIGN_PROBE"\nexec /usr/bin/codesign "$@"\n',
  );
  await chmod(join(root, "bin/codesign"), 0o755);

  const snapshot = join(root, "packaged-snapshot");
  await Bun.write(
    join(root, "capturePackagedAssets.ts"),
    `
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { findPackagedMainViewDir } from ${JSON.stringify(join(import.meta.dirname, "findPackagedMainViewDir.ts"))};
const view = findPackagedMainViewDir(process.env.ELECTROBUN_BUILD_DIR);
const snapshot = ${JSON.stringify(snapshot)};
mkdirSync(snapshot);
for (const file of ["index.html", "worker.js", "sqlite3.wasm"])
  copyFileSync(join(view, file), join(snapshot, file));
`,
  );
  await Bun.write(
    join(root, "recordPostBuild.ts"),
    `
import ${originalHook};
import { execFileSync } from "node:child_process";
execFileSync("bun", [${JSON.stringify(join(root, "capturePackagedAssets.ts"))}], { stdio: "inherit" });
`,
  );
  await config(false);
  const success = await build(channel);
  assert.equal(success.code, 0, success.output);
  const archive = join(
    artifacts,
    `${channel}-macos-arm64-${artifactAppName}.app.tar.zst`,
  );
  assert.ok(existsSync(archive), "Native build must create its update archive");
  const unpacked = join(root, "unpacked");
  await mkdir(unpacked);
  const extraction = Bun.spawn(["tar", "-xf", archive, "-C", unpacked], {
    stdout: "ignore",
    stderr: "inherit",
  });
  assert.equal(await extraction.exited, 0);
  await verifySourceMapStaging(archive, unpacked);
  const archivedView = findPackagedMainViewDir(unpacked);
  const builtView = snapshot;
  for (const file of ["index.html", "worker.js", "sqlite3.wasm"]) {
    const archived = new Uint8Array(
      await Bun.file(join(archivedView, file)).arrayBuffer(),
    );
    const built = new Uint8Array(
      await Bun.file(join(builtView, file)).arrayBuffer(),
    );
    assert.ok(archived.length > 0, `${file} must be packaged`);
    assert.deepEqual(
      archived,
      built,
      `${file} must enter the archive after packaging`,
    );
  }
  const wasm = new Uint8Array(
    await Bun.file(join(archivedView, "sqlite3.wasm")).arrayBuffer(),
  );
  assert.deepEqual(Array.from(wasm.slice(0, 4)), [0, 97, 115, 109]);
  assert.match(await Bun.file(join(archivedView, "index.html")).text(), /\.js/);
  console.log(
    "Native update archive contains the final renderer, SQLite worker, and WASM.",
  );

  await verifyPublishedRelease(
    root,
    artifacts,
    archivedView,
    env,
    channel,
    artifactAppName,
  );
  await verifyMacosDmg(
    root,
    join(
      artifacts,
      `${stagingNameProbe ? "canary-" : ""}macos-arm64-${artifactAppName}.dmg`,
    ),
    join(unpacked, `${bundleName}.app`),
    env,
  );
  await rm(signingProbe);

  await Bun.write(
    join(root, "rejectPostBuild.ts"),
    `import ${originalHook};\nthrow new Error("PACKAGING_FAILURE_PROBE");\n`,
  );
  const previousArtifacts = new Set(await readdir(artifacts));
  await config(true);
  const failure = await build(stagingNameProbe ? "stable" : "canary");
  assert.notEqual(failure.code, 0, "A failed hook must fail the native build");
  assert.match(failure.output, /PACKAGING_FAILURE_PROBE/);
  assert.deepEqual(
    [
      ...new Bun.Glob("**/*.map").scanSync({
        cwd: join(root, "build"),
        dot: true,
      }),
    ].filter((path) => !path.startsWith("sentry-sourcemaps/")),
    [],
    "A failed hook must leave no source map in the build directory",
  );
  assert.equal(
    existsSync(signingProbe),
    false,
    "Signing must not run after a failed hook",
  );
  const remaining = existsSync(artifacts) ? await readdir(artifacts) : [];
  assert.equal(
    remaining.some((file) => !previousArtifacts.has(file)),
    false,
    "A failed hook must not publish installers or update archives",
  );
  console.log(
    "A failing packaging hook aborts before signing and artifact creation.",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
