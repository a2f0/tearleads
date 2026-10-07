import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";
import index from "../index.html";

// The SDK's SQLite worker files, built with the SDK.
function sqliteAsset(name: string) {
  return Bun.file(
    fileURLToPath(import.meta.resolve(`@tearleads/client-sdk/sqlite/${name}`)),
  );
}

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
  "/worker.js": new Response(sqliteAsset("worker.js"), {
    headers: { "Content-Type": "application/javascript" },
  }),
  "/sqlite3.wasm": new Response(sqliteAsset("sqlite3.wasm"), {
    headers: { "Content-Type": "application/wasm" },
  }),
  [`/pdfjs/${pdfjsVersion}/pdf.worker.js`]: new Response(pdfWorker, {
    headers: { "Content-Type": "application/javascript" },
  }),
};

export const devRoute = { "/*": index };
