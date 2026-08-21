import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@symcrypt/sqlite-worker/assets";

const distDir = new URL("../dist/", import.meta.url);
const workerOutput = new URL("worker.js", distDir);
const sqliteWasmOutput = new URL("sqlite3.wasm", distDir);

await mkdir(distDir, { recursive: true });

const workerBuild = await Bun.build({
  entrypoints: [fileURLToPath(getDefaultDatabaseWorkerEntrypointUrl())],
  format: "esm",
  minify: true,
  target: "browser",
});

const workerScript = workerBuild.outputs[0];

if (!workerBuild.success || !workerScript) {
  for (const log of workerBuild.logs) {
    console.error(log);
  }
  throw new Error("Failed to build app-web SQLite worker.");
}

await Bun.write(workerOutput, workerScript);
await copyFile(
  fileURLToPath(getSqliteWasmAssetUrl()),
  fileURLToPath(sqliteWasmOutput),
);
