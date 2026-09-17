import { copyFile, cp, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  getDefaultDatabaseWorkerEntrypointUrl,
  getSqliteWasmAssetUrl,
} from "@tearleads/sqlite-worker/assets";
import { version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";

const distDir = new URL("../dist/", import.meta.url);
const workerOutput = new URL("worker.js", distDir);
const sqliteWasmOutput = new URL("sqlite3.wasm", distDir);
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

const workerBuild = await Bun.build({
  entrypoints: [fileURLToPath(getDefaultDatabaseWorkerEntrypointUrl())],
  format: "esm",
  minify: true,
  target: "browser",
});

const workerScript = workerBuild.outputs[0];

if (!workerBuild.success || !workerScript) {
  for (const log of workerBuild.logs) {
    console.error(log);
  }
  throw new Error("Failed to build app-web SQLite worker.");
}

await Bun.write(workerOutput, workerScript);
await copyFile(
  fileURLToPath(getSqliteWasmAssetUrl()),
  fileURLToPath(sqliteWasmOutput),
);
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
