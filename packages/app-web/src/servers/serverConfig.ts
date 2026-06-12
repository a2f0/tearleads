import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";
import index from "../index.html";

const distDir = `${import.meta.dir}/../../dist`;
const isProduction = process.env.NODE_ENV === "production";

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

const prodIndexHtml = isProduction
  ? await Bun.file(`${distDir}/index.html`).text()
  : "";

export const coreRoutes = {
  "/worker.js": new Response(workerScript, {
    headers: { "Content-Type": "application/javascript" },
  }),
  "/sqlite3.wasm": new Response(sqliteWasm, {
    headers: { "Content-Type": "application/wasm" },
  }),
};

export const devRoute = { "/*": index };

export const serverConfig = {
  routes: coreRoutes,
  async fetch(req: Request) {
    if (!isProduction) {
      return new Response("Not Found", { status: 404 });
    }
    const url = new URL(req.url);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("..")) {
      return new Response("Forbidden", { status: 403 });
    }
    if (pathname !== "/") {
      const file = Bun.file(`${distDir}${pathname}`);
      if (await file.exists()) {
        return new Response(file);
      }
    }
    return new Response(prodIndexHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
