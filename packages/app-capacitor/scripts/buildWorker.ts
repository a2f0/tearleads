import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@symcrypt/sqlite-worker/assets";

const publicDir = new URL("../public/", import.meta.url);

await mkdir(publicDir, { recursive: true });

const workerBuild = await Bun.build({
  entrypoints: [fileURLToPath(getDefaultDatabaseWorkerEntrypointUrl())],
  format: "esm",
  target: "browser",
});

const [workerArtifact] = workerBuild.outputs;
if (!workerBuild.success || !workerArtifact) {
  throw new Error("Failed to build database worker", {
    cause: workerBuild.logs,
  });
}

await Bun.write(new URL("worker.js", publicDir), workerArtifact);

const wasmSrc = fileURLToPath(getSqliteWasmAssetUrl());
await copyFile(wasmSrc, fileURLToPath(new URL("sqlite3.wasm", publicDir)));

console.log("Worker and WASM assets built successfully.");
