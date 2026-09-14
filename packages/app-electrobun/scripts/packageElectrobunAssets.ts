import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loroWasmPlugin } from "@tearleads/loro/bun-plugin";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";
import { createRendererBuildConfig } from "../src/rendererEnvironment";

function findPackagedMainViewDir(buildDir: string): string {
  let directories = [buildDir];
  const matches: string[] = [];
  for (let depth = 0; depth < 4; depth += 1) {
    const children: string[] = [];
    for (const directory of directories) {
      const candidate = join(directory, "Resources/app/views/mainview");
      if (existsSync(join(candidate, "index.html"))) matches.push(candidate);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) children.push(join(directory, entry.name));
      }
    }
    directories = children;
  }
  const [mainViewDir] = matches;
  if (matches.length !== 1 || !mainViewDir)
    throw new Error(
      `Expected one packaged mainview in ${buildDir}, found ${matches.length}`,
    );
  return mainViewDir;
}

async function packageElectrobunAssets(artifactPath: string): Promise<void> {
  const mainViewDir = findPackagedMainViewDir(artifactPath);
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

const artifactPath = process.argv[2];
if (!artifactPath) {
  throw new Error(
    "Usage: bun scripts/packageElectrobunAssets.ts <build-directory>",
  );
}

await packageElectrobunAssets(artifactPath);
