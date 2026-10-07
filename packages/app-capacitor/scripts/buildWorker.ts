import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";

const publicDir = new URL("../public/", import.meta.url);
const pdfWorkerSource = new URL(
  "../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
);
const pdfPackageSource = new URL(
  "../node_modules/pdfjs-dist/",
  import.meta.url,
);
const pdfAssetDirectories = ["cmaps", "wasm", "standard_fonts"] as const;

await mkdir(publicDir, { recursive: true });
// These directories contain only generated PDF.js assets. Drop stale versions
// so native packages carry exactly the renderer version bundled by the app.
await rm(new URL("pdf.worker.js", publicDir), { force: true });
await rm(new URL("pdfjs/", publicDir), { force: true, recursive: true });

// The SDK's SQLite worker files, at the root where createSQLiteRuntime looks.
for (const asset of ["worker.js", "sqlite3.wasm", "sqlite3-licenses.md"]) {
  await copyFile(
    fileURLToPath(import.meta.resolve(`@tearleads/client-sdk/sqlite/${asset}`)),
    fileURLToPath(new URL(asset, publicDir)),
  );
}
await mkdir(new URL(`pdfjs/${pdfjsVersion}/`, publicDir), { recursive: true });
await copyFile(
  fileURLToPath(pdfWorkerSource),
  fileURLToPath(new URL(`pdfjs/${pdfjsVersion}/pdf.worker.js`, publicDir)),
);
for (const directory of pdfAssetDirectories) {
  await cp(
    fileURLToPath(new URL(`${directory}/`, pdfPackageSource)),
    fileURLToPath(new URL(`pdfjs/${pdfjsVersion}/${directory}/`, publicDir)),
    { recursive: true },
  );
}

console.log("Database and PDF worker assets built successfully.");
