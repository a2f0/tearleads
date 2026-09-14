import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loroWasmPlugin } from "@tearleads/loro/bun-plugin";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";
import {
  createRendererBuildConfig,
  sourceMapDirEnvName,
} from "../src/rendererEnvironment";
import { findPackagedMainViewDir } from "./findPackagedMainViewDir";
import {
  hutchSourceMapIdentity,
  prepareSourceMapStaging,
  stageMainProcessSourceMap,
  stageRendererSourceMap,
  sweepSourceMaps,
} from "./sentrySourceMaps";

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "../..");

async function buildRenderer(mainViewDir: string, sourceMapDir?: string) {
  // Emit HTML and its referenced chunks together, including Loro's embedded
  // WASM. Hutch's view output does not preserve Bun's HTML asset layout.
  await rm(mainViewDir, { recursive: true });
  await mkdir(mainViewDir, { recursive: true });
  const rendererBuild = await Bun.build({
    ...createRendererBuildConfig(
      process.env,
      fileURLToPath(new URL("../src/renderer/index.html", import.meta.url)),
    ),
    outdir: mainViewDir,
    publicPath: "/",
    plugins: [loroWasmPlugin],
    ...(sourceMapDir ? { sourcemap: "external" as const } : {}),
  });
  if (!rendererBuild.success) {
    throw new AggregateError(rendererBuild.logs, "Failed to build renderer");
  }
  if (sourceMapDir)
    await stageRendererSourceMap({
      mainViewDir,
      stagingDir: sourceMapDir,
      outputs: rendererBuild.outputs,
      repoRoot,
      packageRoot,
    });
}

async function packageMainView(mainViewDir: string, sourceMapDir?: string) {
  await buildRenderer(mainViewDir, sourceMapDir);

  const workerBuild = await Bun.build({
    entrypoints: [fileURLToPath(getDefaultDatabaseWorkerEntrypointUrl())],
    format: "esm",
    target: "browser",
  });

  const [workerArtifact] = workerBuild.outputs;
  if (!workerBuild.success || !workerArtifact) {
    throw new Error("Failed to build packaged database worker", {
      cause: workerBuild.logs,
    });
  }

  await Bun.write(join(mainViewDir, "worker.js"), workerArtifact);
  await copyFile(
    fileURLToPath(getSqliteWasmAssetUrl()),
    join(mainViewDir, "sqlite3.wasm"),
  );

  console.log(`Packaged Electrobun renderer assets: ${mainViewDir}`);
}

async function packageElectrobunAssets(buildDir: string): Promise<void> {
  const {
    [sourceMapDirEnvName]: sourceMapDir,
    BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT: commit,
  } = process.env;
  let staged: string | undefined;
  let distDir: string | undefined;
  try {
    const mainViewDir = findPackagedMainViewDir(buildDir);
    if (sourceMapDir) {
      const { target, dist } = hutchSourceMapIdentity(process.env);
      await prepareSourceMapStaging({ stagingDir: sourceMapDir, buildDir });
      staged = sourceMapDir;
      distDir = join(sourceMapDir, dist);
      await stageMainProcessSourceMap({
        appDir: resolve(mainViewDir, "../.."),
        stagingDir: distDir,
        commit,
        target,
        repoRoot,
        packageRoot,
      });
    }
    await packageMainView(mainViewDir, distDir);
  } catch (error) {
    // A failed hook leaves no staged source behind; only a directory this run
    // created is removed.
    if (staged) await rm(staged, { recursive: true, force: true });
    throw error;
  } finally {
    // No map may enter the signed app or its archives, including after a
    // failure.
    await sweepSourceMaps(buildDir);
  }
}

const buildDir = process.argv[2];
if (!buildDir) {
  throw new Error(
    "Usage: bun scripts/packageElectrobunAssets.ts <build-directory>",
  );
}

await packageElectrobunAssets(buildDir);
