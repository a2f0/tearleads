import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";

const isProduction = process.env.NODE_ENV === "production";

const indexHtml = isProduction
  ? await Bun.file("./dist/index.html").text()
  : (await import("../index.html")).default;

const workerBuild = await Bun.build({
  entrypoints: [fileURLToPath(getDefaultDatabaseWorkerEntrypointUrl())],
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
    "/*": new Response(indexHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  },
};
