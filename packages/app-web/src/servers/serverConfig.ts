import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";
import { version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";
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
const pdfPackageSource = new URL(
  "../../node_modules/pdfjs-dist/",
  import.meta.url,
);
const pdfAssetRoutes: Record<string, Response> = {};
for (const directory of ["cmaps", "wasm", "standard_fonts"]) {
  const source = new URL(`${directory}/`, pdfPackageSource);
  for (const name of readdirSync(fileURLToPath(source))) {
    const file = Bun.file(new URL(name, source));
    pdfAssetRoutes[`/pdfjs/${pdfjsVersion}/${directory}/${name}`] =
      new Response(file, {
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
  }
}

export const coreRoutes = {
  ...pdfAssetRoutes,
  "/worker.js": new Response(workerScript, {
    headers: { "Content-Type": "application/javascript" },
  }),
  "/sqlite3.wasm": new Response(sqliteWasm, {
    headers: { "Content-Type": "application/wasm" },
  }),
  [`/pdfjs/${pdfjsVersion}/pdf.worker.js`]: new Response(pdfWorker, {
    headers: { "Content-Type": "application/javascript" },
  }),
};

export const devRoute = { "/*": index };
