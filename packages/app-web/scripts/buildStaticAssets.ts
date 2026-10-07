import { copyFile, cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";

const distDir = new URL("../dist/", import.meta.url);
const pdfWorkerSource = new URL(
  "../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
);
const pdfPackageSource = new URL(
  "../node_modules/pdfjs-dist/",
  import.meta.url,
);
const pdfAssetDirectories = ["cmaps", "wasm", "standard_fonts"] as const;

await mkdir(distDir, { recursive: true });

// The SDK's SQLite worker files, at the root where createSQLiteRuntime looks.
for (const asset of ["worker.js", "sqlite3.wasm", "sqlite3-licenses.md"]) {
  await copyFile(
    fileURLToPath(import.meta.resolve(`@tearleads/client-sdk/sqlite/${asset}`)),
    fileURLToPath(new URL(asset, distDir)),
  );
}
await mkdir(new URL(`pdfjs/${pdfjsVersion}/`, distDir), { recursive: true });
await copyFile(
  fileURLToPath(pdfWorkerSource),
  fileURLToPath(new URL(`pdfjs/${pdfjsVersion}/pdf.worker.js`, distDir)),
);
for (const directory of pdfAssetDirectories) {
  await cp(
    fileURLToPath(new URL(`${directory}/`, pdfPackageSource)),
    fileURLToPath(new URL(`pdfjs/${pdfjsVersion}/${directory}/`, distDir)),
    { recursive: true },
  );
}
