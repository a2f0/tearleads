import { copyFile, cp, mkdir, writeFile } from "node:fs/promises";
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

// A real robots.txt, so crawlers do not get the single-page fallback's HTML.
// Every tier serves the same rules: staging stays out of search through its
// noindex tag and header, which a Disallow rule would hide from crawlers.
await writeFile(
  fileURLToPath(new URL("robots.txt", distDir)),
  "User-agent: *\nAllow: /\n",
);

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
