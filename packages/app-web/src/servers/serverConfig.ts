import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";
import index from "../index.html";

const workerBuild = await Bun.build({
  entrypoints: [getDefaultDatabaseWorkerEntrypointUrl().pathname],
  target: "browser",
  format: "esm",
});

if (!workerBuild.success || workerBuild.outputs.length === 0) {
  throw new Error("Worker build failed", { cause: workerBuild.logs });
}

const workerScript = workerBuild.outputs[0];

const sqliteWasm = Bun.file(getSqliteWasmAssetUrl());

export const serverConfig = {
  routes: {
    "/worker.js": new Response(workerScript, {
      headers: { "Content-Type": "application/javascript" },
    }),
    "/sqlite3.wasm": new Response(sqliteWasm, {
      headers: { "Content-Type": "application/wasm" },
    }),
    "/*": index,
  },
};
