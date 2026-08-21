import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@symcrypt/sqlite-worker/assets";
import index from "../index.html";

const workerBuild = await Bun.build({
  entrypoints: [fileURLToPath(getDefaultDatabaseWorkerEntrypointUrl())],
  target: "browser",
  format: "esm",
});

const workerScript = workerBuild.outputs[0];

if (!workerBuild.success || !workerScript) {
  throw new Error("Worker build failed", { cause: workerBuild.logs });
}

const sqliteWasm = Bun.file(getSqliteWasmAssetUrl());

export const coreRoutes = {
  "/worker.js": new Response(workerScript, {
    headers: { "Content-Type": "application/javascript" },
  }),
  "/sqlite3.wasm": new Response(sqliteWasm, {
    headers: { "Content-Type": "application/wasm" },
  }),
};

export const devRoute = { "/*": index };
