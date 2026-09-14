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
  ELECTROBUN_DEVELOPER_ID: "Packaging probe identity (never used)",
  PACKAGING_SIGN_PROBE: signingProbe,
};

async function config(fail: boolean) {
  await Bun.write(
    configPath,
    `
import original from ${originalConfig};
export default {
  ...original,
  app: { ...original.app, name: "PackagingProbe" },
  build: { ...original.build, mac: { ...original.build.mac, codesign: ${fail}, notarize: false } },
  scripts: { postBuild: ${JSON.stringify(fail ? "rejectPostBuild.ts" : "recordPostBuild.ts")} },
};
`,
  );
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
  for (const name of ["node_modules", "src", "scripts"])
    await symlink(join(packageRoot, name), join(root, name));
  for (const name of ["package.json", "hutch.config.ts"])
    await cp(join(packageRoot, name), join(root, name));
  await mkdir(join(root, "bin"));
  await Bun.write(
    join(root, "bin/codesign"),
    '#!/bin/sh\necho invoked > "$PACKAGING_SIGN_PROBE"\nexit 93\n',
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
  const success = await build("stable");
  assert.equal(success.code, 0, success.output);
  const archive = join(
    artifacts,
    "stable-macos-arm64-PackagingProbe.app.tar.zst",
  );
  assert.ok(existsSync(archive), "Native build must create its update archive");
  const unpacked = join(root, "unpacked");
  await mkdir(unpacked);
  const extraction = Bun.spawn(["tar", "-xf", archive, "-C", unpacked], {
    stdout: "ignore",
    stderr: "inherit",
  });
  assert.equal(await extraction.exited, 0);
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

  await verifyPublishedRelease(root, artifacts, archivedView, env);

  await Bun.write(
    join(root, "rejectPostBuild.ts"),
    `import ${originalHook};\nthrow new Error("PACKAGING_FAILURE_PROBE");\n`,
  );
  const previousArtifacts = new Set(await readdir(artifacts));
  await config(true);
  const failure = await build("canary");
  assert.notEqual(failure.code, 0, "A failed hook must fail the native build");
  assert.match(failure.output, /PACKAGING_FAILURE_PROBE/);
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
