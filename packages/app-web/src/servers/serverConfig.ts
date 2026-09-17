import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";
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
const pdfWorker = Bun.file(
  new URL(
    "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ),
);

export const coreRoutes = {
  "/worker.js": new Response(workerScript, {
    headers: { "Content-Type": "application/javascript" },
  }),
  "/sqlite3.wasm": new Response(sqliteWasm, {
    headers: { "Content-Type": "application/wasm" },
  }),
  "/pdf.worker.js": new Response(pdfWorker, {
    headers: { "Content-Type": "application/javascript" },
  }),
};

export const devRoute = { "/*": index };
