import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loroWasmPlugin } from "@tearleads/loro/bun-plugin";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";
import { createRendererBuildConfig } from "../src/rendererEnvironment";
import { findPackagedMainViewDir } from "./findPackagedMainViewDir";

async function packageElectrobunAssets(buildDir: string): Promise<void> {
  const mainViewDir = findPackagedMainViewDir(buildDir);
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
  });
  if (!rendererBuild.success) {
    throw new AggregateError(rendererBuild.logs, "Failed to build renderer");
  }

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

const buildDir = process.argv[2];
if (!buildDir) {
  throw new Error(
    "Usage: bun scripts/packageElectrobunAssets.ts <build-directory>",
  );
}

await packageElectrobunAssets(buildDir);
