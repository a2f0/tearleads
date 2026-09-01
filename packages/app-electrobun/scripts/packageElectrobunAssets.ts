import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";

function findPackagedMainViewDir(artifactPath: string): string {
  let searchDir = dirname(artifactPath);

  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(searchDir, "Resources", "app", "views", "mainview");
    if (existsSync(join(candidate, "index.html"))) {
      return candidate;
    }

    const parentDir = dirname(searchDir);
    if (parentDir === searchDir) {
      break;
    }
    searchDir = parentDir;
  }

  throw new Error(
    `Could not locate packaged mainview resources for ${artifactPath}`,
  );
}

async function packageElectrobunAssets(artifactPath: string): Promise<void> {
  const mainViewDir = findPackagedMainViewDir(artifactPath);
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

  await mkdir(mainViewDir, { recursive: true });
  await Bun.write(join(mainViewDir, "worker.js"), workerArtifact);
  await copyFile(
    fileURLToPath(getSqliteWasmAssetUrl()),
    join(mainViewDir, "sqlite3.wasm"),
  );

  console.log(`Packaged Electrobun renderer assets: ${mainViewDir}`);
}

const artifactPath = process.argv[2];
if (!artifactPath) {
  throw new Error("Usage: bun scripts/packageElectrobunAssets.ts <artifact>");
}

await packageElectrobunAssets(artifactPath);
